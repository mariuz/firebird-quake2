// pmove.js – the player's move run on the client (CL_PredictMovement): the JS twin of what sql/weapons.sql's
// player_think does with the usercmd and of the traces sql/physics.sql runs it through, so a guest can show
// its own move at once instead of a round trip late. Quake 2 had the same pmove on both sides (pmove.c in the
// client and the server); here the server's is PSQL and this is the port of that port, kept in step with it
// by scripts/predict-test.mjs, which runs both over the same inputs and expects the same numbers.
//
// ClipMap holds a map's collision data (the planes, nodes, leaves, brushes and sides of the BSP, the brush
// bounds as the loader computes them) and traces a box through the world's tree or a brush model's
// (CM_BoxTrace: rhc and clip_leaf in physics.sql). `trace` is SV_Trace: the world, then the solid brush models
// given (doors, platforms: their head node, origin and angles) and the box entities given (monsters: their
// absolute box). `pmove` is player_think's movement: the angles, the water level, the duck, the jump, friction,
// the acceleration on the ground, in the air and in water, gravity, noclip, the step-slide move (walk_move,
// fly_move, push_entity), the ground under the box, the step smoothing and the walk's bob. Nothing here touches
// the DOM or the database.

import { angleMatrix } from './renderer.js';

const DIST_EPSILON = 0.03125;
export const MASK_PLAYERSOLID = 33619971;   // SOLID | WINDOW | PLAYERCLIP | MONSTER
const MASK_WATER = 56;                       // LAVA | SLIME | WATER
const FL_ONGROUND = 512;
const RAD = 0.0174532925;

/** A brush's bounds as the loader's geometryRows makes them: the union of the leaves that list it, an axial side exact. */
export function brushBounds(bsp) {
  const bb = new Float64Array(bsp.brushes.length * 6);
  for (let i = 0; i < bsp.brushes.length; i++) { bb[i * 6] = bb[i * 6 + 1] = bb[i * 6 + 2] = Infinity; bb[i * 6 + 3] = bb[i * 6 + 4] = bb[i * 6 + 5] = -Infinity; }
  for (const lf of bsp.leaves) {
    for (let k = 0; k < lf.numLeafBrushes; k++) {
      const b = bsp.leafbrushes[lf.firstLeafBrush + k] * 6;
      for (let a = 0; a < 3; a++) { if (lf.mins[a] < bb[b + a]) bb[b + a] = lf.mins[a]; if (lf.maxs[a] > bb[b + 3 + a]) bb[b + 3 + a] = lf.maxs[a]; }
    }
  }
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  return bsp.brushes.map((b, bi) => {
    const o = bi * 6;
    const bounds = [fin(bb[o], -99999), fin(bb[o + 1], -99999), fin(bb[o + 2], -99999), fin(bb[o + 3], 99999), fin(bb[o + 4], 99999), fin(bb[o + 5], 99999)];
    for (let k = 0; k < b.numSides; k++) {
      const pl = bsp.planes[bsp.brushsides[b.firstSide + k].plane];
      const n = [pl.nx, pl.ny, pl.nz];
      for (let ax = 0; ax < 3; ax++) {
        if (n[ax] > 0.9999) bounds[3 + ax] = Math.min(bounds[3 + ax], pl.dist);
        else if (n[ax] < -0.9999) bounds[ax] = Math.max(bounds[ax], -pl.dist);
      }
    }
    return bounds;
  });
}

/** A fresh trace result: nothing hit yet. */
const newTrace = () => ({ fraction: 1, end: [0, 0, 0], normal: [0, 0, 0], sflags: 0, contents: 0, allsolid: false, startsolid: false, hit: null });

export class ClipMap {
  constructor(bsp) {
    this.bsp = bsp;
    this.bounds = brushBounds(bsp);
    // a side's flags are its texinfo's (SURF_*), as the brushsides table carries them
    this.sideFlags = bsp.brushsides.map((s) => (s.texinfo >= 0 && bsp.texinfo[s.texinfo] ? bsp.texinfo[s.texinfo].flags : 0));
    this.hasWater = bsp.leaves.some((l) => (l.contents & MASK_WATER) !== 0);
  }

  /** model_point_leaf: the leaf of a point under a head node. */
  pointLeaf(head, x, y, z) {
    const { nodes, planes } = this.bsp;
    let n = head;
    while (n >= 0) {
      const nd = nodes[n], pl = planes[nd.plane];
      n = pl.nx * x + pl.ny * y + pl.nz * z - pl.dist >= 0 ? nd.children[0] : nd.children[1];
    }
    return -n - 1;
  }

  /** CM_ClipBoxToBrush for every brush of one leaf (clip_leaf). */
  clipLeaf(leaf, mins, maxs, p1, p2, mask, ispoint, tr) {
    const { bsp } = this;
    const lf = bsp.leaves[leaf];
    if (!lf || !(lf.contents & mask) || !lf.numLeafBrushes) return;
    const bmin = [Math.min(p1[0], p2[0]) + mins[0] - 1, Math.min(p1[1], p2[1]) + mins[1] - 1, Math.min(p1[2], p2[2]) + mins[2] - 1];
    const bmax = [Math.max(p1[0], p2[0]) + maxs[0] + 1, Math.max(p1[1], p2[1]) + maxs[1] + 1, Math.max(p1[2], p2[2]) + maxs[2] + 1];
    for (let k = 0; k < lf.numLeafBrushes; k++) {
      const bi = bsp.leafbrushes[lf.firstLeafBrush + k];
      const br = bsp.brushes[bi];
      if (!(br.contents & mask)) continue;
      const bb = this.bounds[bi];
      if (bb[3] < bmin[0] || bb[0] > bmax[0] || bb[4] < bmin[1] || bb[1] > bmax[1] || bb[5] < bmin[2] || bb[2] > bmax[2]) continue;
      let enterfrac = -1, leavefrac = 1, getout = false, startout = false, skip = false;
      let cnx = 0, cny = 0, cnz = 0, cfl = 0;
      for (let s = 0; s < br.numSides; s++) {
        const si = br.firstSide + s;
        const pl = bsp.planes[bsp.brushsides[si].plane];
        // the side's distance to the box's leading corner
        const sd = pl.dist - (ispoint ? 0 : (pl.nx < 0 ? maxs[0] : mins[0]) * pl.nx + (pl.ny < 0 ? maxs[1] : mins[1]) * pl.ny + (pl.nz < 0 ? maxs[2] : mins[2]) * pl.nz);
        const d1 = p1[0] * pl.nx + p1[1] * pl.ny + p1[2] * pl.nz - sd;
        const d2 = p2[0] * pl.nx + p2[1] * pl.ny + p2[2] * pl.nz - sd;
        if (d2 > 0) getout = true;
        if (d1 > 0) startout = true;
        if (d1 > 0 && d2 >= d1) { skip = true; break; }   // completely in front of this face
        if (d1 <= 0 && d2 <= 0) continue;
        if (d1 > d2) {
          const f = (d1 - DIST_EPSILON) / (d1 - d2);
          if (f > enterfrac) { enterfrac = f; cnx = pl.nx; cny = pl.ny; cnz = pl.nz; cfl = this.sideFlags[si]; }
        } else {
          const f = (d1 + DIST_EPSILON) / (d1 - d2);
          if (f < leavefrac) leavefrac = f;
        }
      }
      if (skip) continue;
      if (!startout) {
        tr.startsolid = true;
        if (!getout) tr.allsolid = true;
      } else if (enterfrac < leavefrac && enterfrac > -1 && enterfrac < tr.fraction) {
        tr.fraction = Math.max(0, enterfrac);
        tr.normal = [cnx, cny, cnz]; tr.sflags = cfl; tr.contents = br.contents;
      }
    }
  }

  /** CM_RecursiveHullCheck (rhc): the segment down the tree, split at each plane with DIST_EPSILON over. */
  rhc(node, p1f, p2f, p1, p2, s1, s2, mins, maxs, ext, mask, ispoint, tr) {
    if (tr.fraction <= p1f) return;   // already hit something nearer
    const { nodes, planes } = this.bsp;
    let n = node, t1, t2, offset, nd, pl;
    for (;;) {
      if (n < 0) { this.clipLeaf(-n - 1, mins, maxs, s1, s2, mask, ispoint, tr); return; }
      nd = nodes[n]; pl = planes[nd.plane];
      t1 = pl.nx * p1[0] + pl.ny * p1[1] + pl.nz * p1[2] - pl.dist;
      t2 = pl.nx * p2[0] + pl.ny * p2[1] + pl.nz * p2[2] - pl.dist;
      offset = ispoint ? 0 : pl.type === 0 ? ext[0] : pl.type === 1 ? ext[1] : pl.type === 2 ? ext[2] : Math.abs(ext[0] * pl.nx) + Math.abs(ext[1] * pl.ny) + Math.abs(ext[2] * pl.nz);
      if (t1 >= offset && t2 >= offset) { n = nd.children[0]; if (n < 0 && !(this.bsp.leaves[-n - 1].contents & mask)) return; continue; }
      if (t1 < -offset && t2 < -offset) { n = nd.children[1]; if (n < 0 && !(this.bsp.leaves[-n - 1].contents & mask)) return; continue; }
      break;
    }
    // put the crosspoint DIST_EPSILON units on the near side
    let side, frac, frac2;
    if (t1 < t2) { const idist = 1 / (t1 - t2); side = 1; frac2 = (t1 + offset + DIST_EPSILON) * idist; frac = (t1 - offset + DIST_EPSILON) * idist; }
    else if (t1 > t2) { const idist = 1 / (t1 - t2); side = 0; frac2 = (t1 - offset - DIST_EPSILON) * idist; frac = (t1 + offset + DIST_EPSILON) * idist; }
    else { side = 0; frac = 1; frac2 = 0; }
    const near = nd.children[side], far = nd.children[side ^ 1];
    const leafEmpty = (c) => c < 0 && !(this.bsp.leaves[-c - 1].contents & mask);
    // move up to the node
    if (frac < 0) frac = 0; if (frac > 1) frac = 1;
    let midf = p1f + (p2f - p1f) * frac;
    let mid = [p1[0] + frac * (p2[0] - p1[0]), p1[1] + frac * (p2[1] - p1[1]), p1[2] + frac * (p2[2] - p1[2])];
    if (!leafEmpty(near)) this.rhc(near, p1f, midf, p1, mid, s1, s2, mins, maxs, ext, mask, ispoint, tr);
    // go past the node
    if (frac2 < 0) frac2 = 0; if (frac2 > 1) frac2 = 1;
    midf = p1f + (p2f - p1f) * frac2;
    mid = [p1[0] + frac2 * (p2[0] - p1[0]), p1[1] + frac2 * (p2[1] - p1[1]), p1[2] + frac2 * (p2[2] - p1[2])];
    if (!leafEmpty(far)) this.rhc(far, midf, p2f, mid, p2, s1, s2, mins, maxs, ext, mask, ispoint, tr);
  }

  /** CM_BoxTrace against one BSP model at `origin` (trace_hull). */
  traceHull(head, origin, mins, maxs, p1, p2, mask) {
    const ispoint = !mins[0] && !mins[1] && !mins[2] && !maxs[0] && !maxs[1] && !maxs[2];
    const ext = [Math.max(-mins[0], maxs[0]), Math.max(-mins[1], maxs[1]), Math.max(-mins[2], maxs[2])];
    const l1 = [p1[0] - origin[0], p1[1] - origin[1], p1[2] - origin[2]], l2 = [p2[0] - origin[0], p2[1] - origin[1], p2[2] - origin[2]];
    const tr = newTrace();
    this.rhc(head, 0, 1, l1, l2, l1, l2, mins, maxs, ext, mask, ispoint, tr);
    if (tr.fraction >= 1) { tr.fraction = 1; tr.end = p2.slice(); }
    else tr.end = [p1[0] + tr.fraction * (p2[0] - p1[0]), p1[1] + tr.fraction * (p2[1] - p1[1]), p1[2] + tr.fraction * (p2[2] - p1[2])];
    if (tr.allsolid) { tr.startsolid = true; tr.fraction = 0; tr.end = p1.slice(); }
    return tr;
  }

  /** SV_PointContents: the world leaf's contents, with any solid brush model standing there (its own tree). */
  pointContents(x, y, z, solids = []) {
    const { bsp } = this;
    let c = bsp.leaves[this.pointLeaf(bsp.models[0].headnode, x, y, z)]?.contents ?? 1;
    for (const s of solids) {
      const m = bsp.models[s.model];
      if (!m) continue;
      const [ox, oy, oz] = s.origin;
      if (x < ox + m.mins[0] || x > ox + m.maxs[0] || y < oy + m.mins[1] || y > oy + m.maxs[1] || z < oz + m.mins[2] || z > oz + m.maxs[2]) continue;
      c |= bsp.leaves[this.pointLeaf(m.headnode, x - ox, y - oy, z - oz)]?.contents ?? 0;
    }
    return c;
  }
}

/** A segment against an absolute box (trace_box): a slab test, the hit normal the entered face's axis. */
export function traceBox(bmin, bmax, p1, p2) {
  const tr = newTrace();
  tr.end = p2.slice();
  if (p1[0] >= bmin[0] && p1[0] <= bmax[0] && p1[1] >= bmin[1] && p1[1] <= bmax[1] && p1[2] >= bmin[2] && p1[2] <= bmax[2]) {
    tr.startsolid = true; tr.fraction = 0; tr.end = p1.slice(); return tr;
  }
  const d = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
  let tmin = 0, tmax = 1, axis = -1, sgn = 0;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (p1[a] < bmin[a] || p1[a] > bmax[a]) return tr; continue; }
    let ta = (bmin[a] - p1[a]) / d[a], tb = (bmax[a] - p1[a]) / d[a];
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > tmin) { tmin = ta; axis = a; sgn = d[a] > 0 ? -1 : 1; }
    if (tb < tmax) tmax = tb;
  }
  if (tmin > tmax || axis < 0 || tmin >= 1) return tr;
  tr.fraction = Math.max(0, tmin - DIST_EPSILON / Math.max(1e-3, Math.hypot(d[0], d[1], d[2])));
  tr.end = [p1[0] + tr.fraction * d[0], p1[1] + tr.fraction * d[1], p1[2] + tr.fraction * d[2]];
  tr.normal = [0, 0, 0]; tr.normal[axis] = sgn;
  return tr;
}

/**
 * SV_Trace (trace_move): the box from p1 to p2 through the world, then the solid brush models (`solids`:
 * [{ model, origin, angles }], a rotated one traced in its own space) and the box entities (`boxes`:
 * [{ mins, maxs, contents }], absolute) whose contents are in `mask`. `hit` names what was hit: null the
 * world, else the solid or box object.
 */
export function trace(cm, mins, maxs, p1, p2, mask, { solids = [], boxes = [] } = {}) {
  const { bsp } = cm;
  const tr = cm.traceHull(bsp.models[0].headnode, [0, 0, 0], mins, maxs, p1, p2, mask);
  if (tr.allsolid) return tr;
  const take = (t, what) => {
    if (!(t.allsolid || t.startsolid || t.fraction < tr.fraction)) return;
    tr.hit = what;
    if (t.allsolid) tr.allsolid = true;
    if (t.startsolid) tr.startsolid = true;
    if (t.fraction < tr.fraction) { tr.fraction = t.fraction; tr.end = t.end; tr.normal = t.normal; tr.sflags = t.sflags; tr.contents = t.contents; }
    if (tr.allsolid) { tr.fraction = 0; tr.end = p1.slice(); }
  };
  for (const s of solids) {
    if (tr.allsolid) break;
    const m = bsp.models[s.model];
    if (!m) continue;
    const [ox, oy, oz] = s.origin, a = s.angles ?? [0, 0, 0];
    let t;
    if (!a[0] && !a[1] && !a[2]) t = cm.traceHull(m.headnode, s.origin, mins, maxs, p1, p2, mask);
    else {
      // CM_TransformedBoxTrace: the segment into the model's space, the hit normal back out
      const M = angleMatrix(a);
      const into = (p) => [M[0] * (p[0] - ox) + M[3] * (p[1] - oy) + M[6] * (p[2] - oz), M[1] * (p[0] - ox) + M[4] * (p[1] - oy) + M[7] * (p[2] - oz), M[2] * (p[0] - ox) + M[5] * (p[1] - oy) + M[8] * (p[2] - oz)];
      t = cm.traceHull(m.headnode, [0, 0, 0], mins, maxs, into(p1), into(p2), mask);
      const n = t.normal;
      t.normal = [M[0] * n[0] + M[1] * n[1] + M[2] * n[2], M[3] * n[0] + M[4] * n[1] + M[5] * n[2], M[6] * n[0] + M[7] * n[1] + M[8] * n[2]];
      t.end = [p1[0] + t.fraction * (p2[0] - p1[0]), p1[1] + t.fraction * (p2[1] - p1[1]), p1[2] + t.fraction * (p2[2] - p1[2])];
    }
    take(t, s);
  }
  for (const b of boxes) {
    if (tr.allsolid) break;
    if (!(mask & b.contents)) continue;
    const t = traceBox([b.mins[0] - maxs[0], b.mins[1] - maxs[1], b.mins[2] - maxs[2]], [b.maxs[0] - mins[0], b.maxs[1] - mins[1], b.maxs[2] - mins[2]], p1, p2);
    t.allsolid = t.startsolid; t.contents = b.contents;
    take(t, b);
  }
  return tr;
}

const vlen = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const anglemod = (a) => a - 360 * Math.floor(a / 360);
/** A player's box: 16 wide, 24 below the origin, 32 above (4 ducked). */
const playerBox = (st) => [[-16, -16, -24], [16, 16, st.ducked ? 4 : 32]];
/** Whether a hit is the ground's kind: the world or a brush model, not a box entity (fly_move's hsolid = 4). */
const groundHit = (tr) => !tr.hit || tr.hit.model !== undefined;

/** ClipVelocity: slide along the plane; blocked bits 1 floor, 2 step. */
export function clipVelocity(v, n, overbounce) {
  let blocked = 0;
  if (n[2] > 0) blocked |= 1;
  if (n[2] === 0) blocked |= 2;
  const backoff = (v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) * overbounce;
  const o = [v[0] - n[0] * backoff, v[1] - n[1] * backoff, v[2] - n[2] * backoff];
  for (let i = 0; i < 3; i++) if (o[i] > -0.1 && o[i] < 0.1) o[i] = 0;
  return { v: o, blocked };
}

/** SV_FlyMove (fly_move): slide `st` along the world for dt, bumping up to four times; blocked bits 1 floor, 2 wall. */
function flyMove(cm, st, dt, world) {
  const [mins, maxs] = playerBox(st);
  let p = [st.x, st.y, st.z], v = [st.vx, st.vy, st.vz];
  let ov = v.slice();
  const pv = v.slice();
  let timeLeft = dt, blocked = 0;
  const planes = [];
  for (let bump = 0; bump < 4; bump++) {
    if (!v[0] && !v[1] && !v[2]) { if (bump === 0) return 0; break; }
    const tr = trace(cm, mins, maxs, p, [p[0] + timeLeft * v[0], p[1] + timeLeft * v[1], p[2] + timeLeft * v[2]], MASK_PLAYERSOLID, world);
    if (tr.allsolid) { v = [0, 0, 0]; blocked = 3; break; }
    if (tr.fraction > 0) { p = tr.end.slice(); ov = v.slice(); planes.length = 0; }
    if (tr.fraction === 1) break;
    if (tr.normal[2] > 0.7) { blocked |= 1; if (groundHit(tr)) st.onground = true; }
    if (tr.normal[2] === 0) blocked |= 2;
    timeLeft -= timeLeft * tr.fraction;
    if (planes.length >= 5) { v = [0, 0, 0]; blocked = 3; break; }
    planes.push(tr.normal.slice());
    // modify original_velocity so it parallels all of the clip planes
    let ok = false, nv = null;
    for (let i = 0; i < planes.length; i++) {
      nv = clipVelocity(ov, planes[i], 1).v;
      ok = true;
      for (let j = 0; j < planes.length; j++) if (j !== i && nv[0] * planes[j][0] + nv[1] * planes[j][1] + nv[2] * planes[j][2] < 0) { ok = false; break; }
      if (ok) break;
    }
    if (ok) v = nv;
    else {
      if (planes.length !== 2) { v = [0, 0, 0]; break; }
      const [a, b] = planes;
      const q = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const d = q[0] * v[0] + q[1] * v[1] + q[2] * v[2];
      v = [q[0] * d, q[1] * d, q[2] * d];
    }
    // if the new velocity is against the original velocity, stop dead
    if (v[0] * pv[0] + v[1] * pv[1] + v[2] * pv[2] <= 0) { v = [0, 0, 0]; break; }
  }
  st.x = p[0]; st.y = p[1]; st.z = p[2]; st.vx = v[0]; st.vy = v[1]; st.vz = v[2];
  return blocked;
}

/** SV_PushEntity (push_entity): move by a vector, stopping at the first thing hit. */
function pushEntity(cm, st, d, world) {
  const [mins, maxs] = playerBox(st);
  const tr = trace(cm, mins, maxs, [st.x, st.y, st.z], [st.x + d[0], st.y + d[1], st.z + d[2]], MASK_PLAYERSOLID, world);
  st.x = tr.end[0]; st.y = tr.end[1]; st.z = tr.end[2];
  return tr;
}

/** PM_StepSlideMove (walk_move): slide; a wall in the way, try again from a step up, kept only on ground. */
function walkMove(cm, st, dt, oldonground, world) {
  const old = { x: st.x, y: st.y, z: st.z, vx: st.vx, vy: st.vy, vz: st.vz };
  const wl = st.waterlevel;
  const clip = flyMove(cm, st, dt, world);
  if (!(clip & 2)) return;                       // move looks good
  if (!oldonground && wl === 0) return;          // don't stair up while jumping
  const ns = { x: st.x, y: st.y, z: st.z, vx: st.vx, vy: st.vy, vz: st.vz, onground: st.onground };
  Object.assign(st, old);
  pushEntity(cm, st, [0, 0, 18], world);
  st.vx = old.vx; st.vy = old.vy; st.vz = 0;
  flyMove(cm, st, dt, world);
  const tr = pushEntity(cm, st, [0, 0, -18 + old.vz * dt], world);
  if (tr.normal[2] > 0.7 && tr.fraction < 1) st.onground = true;
  else Object.assign(st, ns);
}

/** PM_CatagorizePosition's water level at the origin: 0 none, 1 feet, 2 waist, 3 eyes (check_water). */
export function checkWater(cm, st, solids = []) {
  if (!cm.hasWater) return { waterlevel: 0, watertype: 0 };
  const [mins, maxs] = playerBox(st);
  let c = cm.pointContents(st.x, st.y, st.z + mins[2] + 1, solids);
  if (!(c & MASK_WATER)) return { waterlevel: 0, watertype: 0 };
  const watertype = c & MASK_WATER;
  let waterlevel = 1;
  c = cm.pointContents(st.x, st.y, st.z + (mins[2] + maxs[2]) / 2, solids);
  if (c & MASK_WATER) {
    waterlevel = 2;
    c = cm.pointContents(st.x, st.y, st.z + 22, solids);
    if (c & MASK_WATER) waterlevel = 3;
  }
  return { waterlevel, watertype };
}

/**
 * The player state a prediction runs from, as the Q2_TIC row carries it: the origin and velocity, the angles,
 * the ground flag, the duck, the jump key's release, the water, noclip, the step smoothing and the bob's clock.
 */
export function stateFromRow(row) {
  return { x: row.PX, y: row.PY, z: row.PZ, vx: row.VX ?? 0, vy: row.VY ?? 0, vz: row.VZ ?? 0, yaw: row.YAW, pitch: row.PITCH - (row.BOB_PITCH ?? 0) - (row.PUNCH ?? 0),
    onground: !!row.ONGROUND, ducked: !!row.DUCKED, jumpReleased: row.JUMP_RELEASED == null ? true : !!row.JUMP_RELEASED,
    waterlevel: row.WATERLEVEL ?? 0, watertype: row.WATERTYPE ?? 0, noclip: !!row.NOCLIP, stepz: row.STEPZ ?? 0, bobtime: row.BOBTIME ?? 0 };
}

/**
 * ClientThink's move for one tic of `dt` seconds (player_think's movement, PM_* in pmove.c): `st` is changed in
 * place and returned. `cmd` is the usercmd's { fwd, side, yawd, pitchd, jump (Quake's upmove: cl_upspeed up, its negative a crouch), run }; `world`
 * the solids and boxes to clip against (see trace), `gravity` the map's, `view` the game row's bob and run cvars and sv_airaccelerate. The view the state gives is in
 * `view`: { x, y, z, viewZ, yaw, pitch, roll } with the bob and the step smoothing in (SV_CalcViewOffset).
 */
/** p_view.c's view cvars as the game row has them by default (bob_up, bob_pitch, bob_roll, run_pitch, run_roll); a guest's come with the map message. */
export const VIEW_CVARS = Object.freeze({ bobUp: 0.005, bobPitch: 0.002, bobRoll: 0.002, runPitch: 0.002, runRoll: 0.005, airaccelerate: 0 });

export function pmove(cm, st, cmd, dt, { solids = [], boxes = [], gravity = 800, view = VIEW_CVARS } = {}) {
  const world = { solids, boxes };
  // the view angles
  st.yaw = anglemod(st.yaw + (cmd.yawd ?? 0));
  st.pitch = Math.max(-89, Math.min(89, st.pitch + (cmd.pitchd ?? 0)));
  const oldz = st.z;
  // the water level where the player stands now (P_WorldEffects' check, before the move)
  const w = checkWater(cm, st, solids);
  st.waterlevel = w.waterlevel; st.watertype = w.watertype;
  const wl = st.waterlevel, wt = st.watertype;
  let onground = st.onground;
  if (onground && st.vz > 180) onground = false;   // going up faster than 180 leaves the ground
  let maxspd = cmd.run ? 300 : 200;
  // PM_CheckDuck
  let ducked;
  if (cmd.jump < 0 && onground && !st.noclip) ducked = true;
  else if (st.ducked) {
    const tr = trace(cm, [-16, -16, -24], [16, 16, 32], [st.x, st.y, st.z], [st.x, st.y, st.z], MASK_PLAYERSOLID, world);
    ducked = tr.allsolid;
  } else ducked = false;
  st.ducked = ducked;
  if (ducked) maxspd = 100;
  // PM_CheckJump
  let jr2 = st.jumpReleased;
  if (cmd.jump >= 10) {   // (the upmove, ±cl_upspeed: 10 or more is the jump key, as PM_CheckJump had it)
    if (wl >= 2) {
      if (st.vz > -300) st.vz = wt & 32 ? 100 : wt & 16 ? 80 : 50;
      onground = false;
    } else if (onground && st.jumpReleased) {
      st.vz += 270; onground = false; jr2 = false;
    }
  } else jr2 = true;
  // PM_Friction
  if (onground || wl >= 2) {
    const spd = vlen(st.vx, st.vy, st.vz);
    if (spd > 1) {
      let drop = 0;
      if (onground) drop += (spd < 100 ? 100 : spd) * 6 * dt;
      if (wl >= 2) drop += spd * 1 * wl * dt;
      const ns = Math.max(0, spd - drop) / spd;
      st.vx *= ns; st.vy *= ns; st.vz *= ns;
    }
  }
  // the wish direction
  let fx = Math.cos(st.yaw * RAD), fy = Math.sin(st.yaw * RAD);
  const rx = fy, ry = -fx;
  const fwd = cmd.fwd ?? 0, side = cmd.side ?? 0, jump = cmd.jump ?? 0;
  if (wl >= 2) {
    // PM_WaterMove
    const fz = -Math.sin(st.pitch * RAD);
    fx *= Math.cos(st.pitch * RAD); fy *= Math.cos(st.pitch * RAD);
    let wx = fx * fwd * maxspd + rx * side * maxspd, wy = fy * fwd * maxspd + ry * side * maxspd, wz = fz * fwd * maxspd;
    if (fwd === 0 && side === 0 && jump === 0) wz -= 60;
    else wz += jump;   // (the upmove: up on the jump key, crouch swims down)
    let wspd = vlen(wx, wy, wz);
    if (wspd > maxspd) { wx = wx * maxspd / wspd; wy = wy * maxspd / wspd; wz = wz * maxspd / wspd; wspd = maxspd; }
    wspd *= 0.5;
    if (wspd > 0) {
      const wl2 = vlen(wx, wy, wz);
      const cur = (st.vx * wx + st.vy * wy + st.vz * wz) / wl2;
      const add = wspd - cur;
      if (add > 0) { const acc = Math.min(add, 10 * wspd * dt); st.vx += acc * wx / wl2; st.vy += acc * wy / wl2; st.vz += acc * wz / wl2; }
    }
  } else {
    let wx = fx * fwd * maxspd + rx * side * maxspd, wy = fy * fwd * maxspd + ry * side * maxspd;
    let wspd = vlen(wx, wy, 0);
    if (wspd > maxspd) { wx = wx * maxspd / wspd; wy = wy * maxspd / wspd; wspd = maxspd; }
    // PM_AirMove: on the ground (or wading) PM_Accelerate at 10; in the air PM_AirAccelerate with sv_airaccelerate on (the wish speed
    // capped at 30, the acceleration 10 over the whole wish speed), else PM_Accelerate at 1
    if (wspd > 0 && (onground || wl === 1)) {
      const cur = (st.vx * wx + st.vy * wy) / wspd;
      const add = wspd - cur;
      if (add > 0) { const acc = Math.min(add, 10 * wspd * dt); st.vx += acc * wx / wspd; st.vy += acc * wy / wspd; }
    } else if (wspd > 0) {
      const air = (view.airaccelerate ?? 0) > 0;
      const cur = (st.vx * wx + st.vy * wy) / wspd;
      const add = (air ? Math.min(wspd, 30) : wspd) - cur;
      if (add > 0) { const acc = Math.min(add, (air ? 10 : 1) * wspd * dt); st.vx += acc * wx / wspd; st.vy += acc * wy / wspd; }
    }
  }
  // gravity; on the ground no vertical speed at all
  if (!onground && wl < 2) st.vz -= gravity * dt;
  else if (onground && wl < 2 && !st.noclip) st.vz = 0;
  if (st.noclip) {
    // PM_SPECTATOR: fly where the view points, jump to rise, through everything
    st.vx = (fwd * Math.cos(st.yaw * RAD) * Math.cos(st.pitch * RAD) + side * Math.sin(st.yaw * RAD)) * maxspd;
    st.vy = (fwd * Math.sin(st.yaw * RAD) * Math.cos(st.pitch * RAD) - side * Math.cos(st.yaw * RAD)) * maxspd;
    st.vz = (-fwd * Math.sin(st.pitch * RAD) + jump / 200) * maxspd;   // (the upmove as a share of cl_upspeed's 200)
    st.x += st.vx * dt; st.y += st.vy * dt; st.z += st.vz * dt;
    st.onground = false;
  } else {
    // the move: the ground flag is cleared first, the move sets it again when it lands
    st.onground = false;
    if (wl >= 2) flyMove(cm, st, dt, world);
    else walkMove(cm, st, dt, onground, world);
    if (wl < 2 && !st.onground && st.vz <= 180) {
      // PM_CatagorizePosition: on the ground means a floor within a quarter unit under the box
      const [mins, maxs] = playerBox(st);
      const p = [st.x, st.y, st.z];
      let tr = cm.traceHull(cm.bsp.models[0].headnode, [0, 0, 0], mins, maxs, p, [st.x, st.y, st.z - 0.25], MASK_PLAYERSOLID);
      if (tr.fraction === 1 || tr.normal[2] < 0.7) tr = trace(cm, mins, maxs, p, [st.x, st.y, st.z - 0.25], MASK_PLAYERSOLID, world);
      if (tr.fraction < 1 && tr.normal[2] >= 0.7 && groundHit(tr)) { st.onground = true; st.vz = Math.max(st.vz, 0); }
    }
  }
  st.jumpReleased = jr2;
  // the view's bob (SV_CalcViewOffset): the walk cycle advances with the speed on the ground, four times as fast ducked
  const xys = Math.sqrt(st.vx * st.vx + st.vy * st.vy);
  let bt;
  if (xys < 5) bt = 0;
  else if (st.onground) bt = st.bobtime + (xys > 210 ? 0.25 : xys > 100 ? 0.125 : 0.0625) * dt / 0.1;
  else bt = st.bobtime;
  st.bobtime = bt;
  const bts = ducked ? bt * 4 : bt;
  const bfs = Math.abs(Math.sin(bts * Math.PI));
  const bobz = Math.min(6, bfs * xys * view.bobUp);
  let bobp = bfs * view.bobPitch * xys * (ducked ? 6 : 1);
  let bobr = bfs * view.bobRoll * xys * (ducked ? 6 : 1) * (Math.floor(bts) % 2 === 1 ? -1 : 1);
  // SV_CalcViewOffset's angles from the velocity: run_pitch along the view's forward, run_roll along its right
  const cy = Math.cos(st.yaw * RAD), sy = Math.sin(st.yaw * RAD), cp = Math.cos(st.pitch * RAD), sp = Math.sin(st.pitch * RAD);
  bobp += ((st.vx * cy + st.vy * sy) * cp - st.vz * sp) * view.runPitch;
  bobr += (st.vx * sy - st.vy * cy) * view.runRoll;
  // smooth the view over steps
  st.stepz = st.onground && st.z - oldz > 0 && st.z - oldz <= 18 ? Math.min(st.stepz + (st.z - oldz), 18) : Math.max(0, st.stepz - 160 * dt);
  st.view = { x: st.x, y: st.y, z: st.z, viewZ: st.z + (ducked ? -2 : 22) - st.stepz + bobz, yaw: st.yaw, pitch: st.pitch + bobp, roll: bobr };
  return st;
}
