// lerp.js – the frames between tics: the game steps at 20 Hz and the display runs faster, so each paint
// shows the last tic's frame moved toward the current one by the fraction of the tic gone by, as the Quake 2
// client drew the server's frames (CL_AddPacketEntities moved each entity between two server frames by
// cl.lerpfrac, CL_CalcViewValues the view's origin; the view's angles were the client's own, immediate).
//
// A FrameLerp holds the last two tics' frames (the Q2_TIC row and decodeFrame's result) and gives the frame at a
// fraction: the eye between the two origins, the alias models and sprites between their two poses (one just come
// or moved more than 512 units snaps), the brush models' face rows with their origins and angles between the two
// (the doors, platforms and fans move smoothly), the row's angles the current tic's plus whatever the caller adds
// (the mouse's turn not yet sent, so looking around never waits for a tic), and each alias model's pose between
// the frame it left and the one it is in (CL_AddPacketEntities' oldframe and backlerp: the animations step at
// 10 Hz, the server's rate, and the client blended each step over the tenth of a second it took). Nothing here
// touches the DOM.

const lerp = (a, b, f) => a + (b - a) * f;
const lerpAngle = (a, b, f) => { let d = b - a; if (d > 180) d -= 360; if (d < -180) d += 360; return a + d * f; };
const SNAP = 512;   // an entity that moved farther in one tic teleported: no lerp (CL_AddPacketEntities' 512)
const TIC = 0.05, BLEND = 0.1;   // a tic; a frame's blend, the server frame the client lerped over

export class FrameLerp {
  constructor() {
    this.prev = null; this.cur = null;
    this.anim = new Map();   // each entity's frame, the one before it and the tic the change came with, for the blend
  }

  /** A tic's frame comes in: `row` its Q2_TIC row, `f` decodeFrame's result (the fast mode's face rows). */
  push(row, f) {
    const ents = new Map();
    for (const e of f.ents) {
      ents.set(e[0], e);
      const a = this.anim.get(e[0]);
      if (!a || a.model !== e[1]) this.anim.set(e[0], { model: e[1], frame: e[2], old: e[2], t0: -1 });   // (a newcomer, or another model: no blend)
      else if (a.frame !== e[2]) { a.old = a.frame; a.frame = e[2]; a.t0 = row.TIME_; }
    }
    for (const id of this.anim.keys()) if (!ents.has(id)) this.anim.delete(id);
    const brushes = new Map();   // the brush models' origins, by entity, from the first face row of each
    for (const r of f.faces) if (r.length === 5 && r[1] && !brushes.has(r[1])) brushes.set(r[1], [r[2], r[3], r[4]]);
    this.prev = this.cur;
    this.cur = { row, f, ents, brushes };
  }

  /** The current tic's frame as pushed, or null before any. */
  get frame() { return this.cur?.f ?? null; }

  /**
   * The frame at `frac` (0 the previous tic, 1 the current): { row, faces, ents, brushAngles }. `angles` are the
   * view's, added to the current row's yaw and pitch (the turn the input holds); a `view` given instead ({ x, y,
   * z, viewZ, yaw, pitch, roll }: a guest's own move predicted ahead of the host's frames) is the eye and the
   * angles as they are, the frame's entities still moved by the fraction; `exact` paints the current tic as it
   * is (the SQL-projecting mode: its faces are projected at the tic's eye and cannot move). An entity whose
   * frame changed within the last tenth of a second carries the frame it left at [14] and the blend toward the
   * new one at [15] (backlerp: 1 as the change comes, 0 a tenth of a second on).
   */
  at(frac, { yaw = 0, pitch = 0, view = null } = {}, exact = false) {
    const c = this.cur;
    if (!c) return null;
    const p = this.prev;
    const f = p && !exact ? Math.max(0, Math.min(1, frac)) : 1;
    const row = { ...c.row };
    if (view) {
      row.PX = view.x; row.PY = view.y; row.PZ = view.z; row.VIEW_Z = view.viewZ; row.YAW = view.yaw; row.PITCH = view.pitch;
      if (view.roll != null) row.ROLL = view.roll;
    } else if (f < 1) {
      const pr = p.row;
      if (Math.hypot(c.row.PX - pr.PX, c.row.PY - pr.PY, c.row.PZ - pr.PZ) < SNAP) {
        row.PX = lerp(pr.PX, c.row.PX, f); row.PY = lerp(pr.PY, c.row.PY, f); row.PZ = lerp(pr.PZ, c.row.PZ, f);
        row.VIEW_Z = lerp(pr.VIEW_Z, c.row.VIEW_Z, f);
      }
    }
    if (yaw && !view) { row.YAW = (c.row.YAW + yaw) % 360; if (row.YAW < 0) row.YAW += 360; }
    if (pitch && !view) row.PITCH = Math.max(-89, Math.min(89, c.row.PITCH + pitch));
    let ents = c.f.ents, faces = c.f.faces, brushAngles = c.f.brushAngles;
    if (f < 1) {
      ents = c.f.ents.map((e) => {
        const o = p.ents.get(e[0]);
        if (!o || o[1] !== e[1]) return e;
        if (Math.hypot(e[4] - o[4], e[5] - o[5], e[6] - o[6]) >= SNAP) return e;
        const r = e.slice();
        r[4] = lerp(o[4], e[4], f); r[5] = lerp(o[5], e[5], f); r[6] = lerp(o[6], e[6], f);
        r[7] = lerpAngle(o[7], e[7], f); r[8] = lerpAngle(o[8], e[8], f); r[9] = lerpAngle(o[9], e[9], f);
        return r;
      });
      let moved = false;
      for (const [ent, o] of c.brushes) { const q = p.brushes.get(ent); if (q && (q[0] !== o[0] || q[1] !== o[1] || q[2] !== o[2])) { moved = true; break; } }
      if (moved) {
        faces = c.f.faces.map((r) => {
          if (r.length !== 5 || !r[1]) return r;
          const q = p.brushes.get(r[1]);
          if (!q) return r;
          return [r[0], r[1], lerp(q[0], r[2], f), lerp(q[1], r[3], f), lerp(q[2], r[4], f)];
        });
      }
      if (c.f.brushAngles.size) {
        brushAngles = new Map();
        for (const [ent, a] of c.f.brushAngles) {
          const q = p.f.brushAngles.get(ent);
          brushAngles.set(ent, q ? [lerpAngle(q[0], a[0], f), lerpAngle(q[1], a[1], f), lerpAngle(q[2], a[2], f)] : a);
        }
      }
    }
    if (!exact) {
      // the poses: a frame that changed in the tic ending at t0 blends from the old one over a tenth of a second
      // from that tic's start (the change tic 1 → 0.5, the next 0.5 → 0), as the client's backlerp did over a server frame
      const time = c.row.TIME_ - (1 - f) * TIC;
      let out = null;
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i], a = this.anim.get(e[0]);
        if (!a || a.t0 < 0 || a.old === a.frame) continue;
        const bl = 1 - Math.max(0, Math.min(1, (time - a.t0 + TIC) / BLEND));
        if (bl <= 0) continue;
        if (!out) out = ents.slice();
        const r = e.slice();
        r[14] = a.old; r[15] = bl;
        out[i] = r;
      }
      if (out) ents = out;
    }
    return { row, faces, ents, brushAngles, frac: f };
  }
}
