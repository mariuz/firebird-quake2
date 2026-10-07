// renderer.js – the painter. Firebird says which polygons are on screen and
// where (FRAME_FACES) and which models stand where (FRAME_ENTS); this file
// turns that into pixels the way Quake 2's software renderer (ref_soft) did:
// an 8-bit framebuffer of palette indices, a z-buffer, perspective-correct
// spans over a surface cache (.wal texture × lightmap → colormap), alias
// models with Gouraud light, billboard sprites, particles, the sky box, and
// translucent surfaces blended through the alpha map of colormap.pcx.

import { ANORMS } from './md2.js';
import { Wal, loadPcx } from './pak.js';
import { SURF } from './bsp.js';

const SURF_CACHE_MAX = 2000;
const SKY_SUFFIX = ['rt', 'bk', 'lf', 'ft', 'up', 'dn'];

export class Renderer {
  constructor(canvas, { palette, colormap, alphamap, pak }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.palette = palette;      // Uint32Array(256) ABGR
    this.colormap = colormap;    // Uint8Array(64*256)
    this.alphamap = alphamap;    // Uint8Array(256*256) or null
    this.pak = pak;
    this.sinTable = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.sinTable[i] = Math.sin((i / 256) * Math.PI * 2) * 8;
    this.surfCache = new Map();
    this.faceInfo = new Map();   // face id → { bsp, f, ti }
    this.textures = new Map();   // name → Wal | null
    this.models = null;
    this.particles = [];
    this.sbarLines = 0;
    this.sky = null;             // [6 × { w, h, data }]
    this.lightScale = 1.4;       // ref_gl's intensity: the software lightmaps are dim on their own
    this.vv = new Float64Array(64 * 7);   // a polygon's vertices in view space
    this.pp = new Float64Array(64 * 5);   // ... and on screen, clipped
    this.av = new Float32Array(1024 * 7); // an alias model's transformed vertices
    this.setSize(320, 240);
  }

  setSize(w, h) {
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.fb = new Uint8Array(w * h);
    this.zb = new Float32Array(w * h);
    this.image = this.ctx.createImageData(w, h);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.edgeL = new Float32Array(h * 5);   // x, iz, sz, tz, light per scanline
    this.edgeR = new Float32Array(h * 5);
  }

  /** The model registry (loader.js's res.models) and the world's faces. */
  setResources(res) {
    this.models = res.models;
    this.faceInfo.clear();
    this.surfCache.clear();
    for (const m of res.models.values()) {
      if (m.kind !== 'B' || m.sub !== 0) continue;
      const bsp = m.bsp;
      bsp.faces.forEach((f, i) => {
        const ti = bsp.texinfo[f.texinfo];
        this.faceInfo.set(m.faceBase + i, { bsp, f, ti });
      });
    }
  }

  /** textures/<name>.wal, cached; null when the pak lacks it. */
  texture(name) {
    let t = this.textures.get(name);
    if (t !== undefined) return t;
    t = null;
    const file = `textures/${name}.wal`;
    if (this.pak && this.pak.has(file)) {
      try { t = new Wal(this.pak.get(file), name); } catch { t = null; }
    }
    if (!t) t = { name, w: 64, h: 64, mips: [new Uint8Array(64 * 64).fill(8)], animname: '', flags: 0 };
    t.id = this.textures.size;
    this.textures.set(name, t);
    return t;
  }

  /** env/<name>{rt,bk,lf,ft,up,dn}.pcx */
  setSky(name) {
    this.sky = null;
    if (!name || !this.pak) return;
    const faces = [];
    for (const suf of SKY_SUFFIX) {
      const file = `env/${name}${suf}.pcx`;
      if (!this.pak.has(file)) { this.sky = null; return; }
      try { const p = loadPcx(this.pak.get(file)); faces.push({ w: p.w, h: p.h, data: p.data }); } catch { this.sky = null; return; }
    }
    this.sky = faces;
  }

  // ── surface cache (R_DrawSurface) ───────────────────────────────────────
  surface(faceId, styles, time, frame) {
    const info = this.faceInfo.get(faceId);
    if (!info) return null;
    const { bsp, f, ti } = info;
    let tex = this.texture(ti.texture);
    // texture animation: the .wal's animname chain, 2 Hz for the world
    if (tex.animname) {
      let n = (frame ? frame : Math.floor(time * 2)) % 16;
      let t = tex;
      const start = tex.name;
      while (n-- > 0) {
        if (!t.animname) break;
        t = this.texture(t.animname);
        if (t.name === start) { tex = t; break; }
      }
      tex = t;
    }
    let light = 0;
    const fs = f.styles;
    for (let i = 0; i < 4 && fs[i] !== 255; i++) {
      const v = styles[fs[i]] ?? 1;
      light = light * 7 + Math.round(v * 16);
    }
    // face, texture and light levels in one number (the brightness setting clears the cache)
    const key = (faceId * 4096 + tex.id) * 16384 + light;
    let s = this.surfCache.get(key);
    if (s !== undefined) return s;
    if (this.surfCache.size > SURF_CACHE_MAX) this.surfCache.clear();
    s = this.buildSurface(bsp, f, tex, styles);
    this.surfCache.set(key, s);
    return s;
  }

  /**
   * The texture tiled under the face's lightmap, through the colormap. The
   * lightmap is bilinear over 16×16 texel blocks: one row of light values is
   * interpolated per texel row, then stepped along it (R_DrawSurfaceBlock8).
   */
  buildSurface(bsp, f, tex, styles) {
    const sw = Math.max(1, f.extents[0]);
    const sh = Math.max(1, f.extents[1]);
    const data = new Uint8Array(sw * sh);
    const lw = f.lightW;
    const lh = f.lightH;
    const ls = this.lightScale;
    const block = new Float32Array(lw * lh);
    if (f.lightofs >= 0 && bsp.lightdata.length) {
      const ld = bsp.lightdata;
      let off = f.lightofs;
      for (let i = 0; i < 4 && f.styles[i] !== 255; i++) {
        const scale = (styles[f.styles[i]] ?? 1) * ls;
        for (let k = 0; k < lw * lh; k++) block[k] += ld[off + k] * scale;
        off += lw * lh;
      }
    } else {
      block.fill((f.flags & (SURF.WARP | SURF.SKY) ? 255 : f.lightofs === -1 ? 255 : 0) * ls);
    }
    const cm = this.colormap;
    const texw = tex.w, texh = tex.h, mip = tex.mips[0];
    const smin = f.texturemins[0], tmin = f.texturemins[1];
    const col = new Int32Array(sw);
    for (let u = 0; u < sw; u++) col[u] = (((u + smin) % texw) + texw) % texw;
    const rowL = new Float32Array(lw);
    for (let v = 0; v < sh; v++) {
      const mrow = ((((v + tmin) % texh) + texh) % texh) * texw;
      const lv = v >> 4, lf = (v & 15) / 16;
      const lv1 = Math.min(lv + 1, lh - 1);
      const b0 = lv * lw, b1 = lv1 * lw;
      for (let lu = 0; lu < lw; lu++) rowL[lu] = block[b0 + lu] * (1 - lf) + block[b1 + lu] * lf;
      const row = v * sw;
      let u = 0;
      for (let lu = 0; u < sw; lu++) {
        let l = rowL[lu];
        const step = (rowL[Math.min(lu + 1, lw - 1)] - l) / 16;
        const end = Math.min(sw, u + 16);
        for (; u < end; u++, l += step) {
          let shade = (255 - l) >> 2;
          if (shade < 0) shade = 0; else if (shade > 63) shade = 63;
          data[row + u] = cm[(shade << 8) | mip[mrow + col[u]]];
        }
      }
    }
    return { data, w: sw, h: sh, smin, tmin, mask: (sw & (sw - 1)) === 0 && (sh & (sh - 1)) === 0 };
  }

  // ── a frame ─────────────────────────────────────────────────────────────
  beginFrame(view) {
    this.view = view;
    const { w, h } = this;
    this.zb.fill(0);
    this.fb.fill(0);
    const yaw = (view.yaw * Math.PI) / 180, pitch = (view.pitch * Math.PI) / 180;
    const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    view.fwd = [cp * cy, cp * sy, -sp];
    view.right = [sy, -cy, 0];
    view.up = [sp * cy, sp * sy, cp];
    if (view.roll) {
      const r = (view.roll * Math.PI) / 180, cr = Math.cos(r), sr = Math.sin(r);
      const R = view.right, U = view.up;
      view.right = [R[0] * cr + U[0] * sr, R[1] * cr + U[1] * sr, R[2] * cr + U[2] * sr];
      view.up = [-R[0] * sr + U[0] * cr, -R[1] * sr + U[1] * cr, -R[2] * sr + U[2] * cr];
    }
    view.scale = (w / 2) / Math.tan((view.fov * Math.PI) / 360);
    view.cx = w / 2;
    view.cy = (h - this.sbarLines) / 2;
  }

  /** Room for n vertices in the view-space (stride 7) and screen-space (stride 5) scratch polygons. */
  polyRoom(n) {
    if (this.vv.length < n * 7) { this.vv = new Float64Array(n * 7 * 2); this.pp = new Float64Array(n * 5 * 4); }
  }

  /**
   * The world and brush models: rows [face, seq, vf, vr, vu, sx, sy, s, t, ent_id]
   * in order (view-space forward/right/up, projected x/y or null when behind
   * the near plane, texel s/t). Polygons that cross the near plane are
   * clipped here, in view space, before scan conversion.
   */
  drawFaces(rows, styles, time, entFrames) {
    let i = 0;
    const n = rows.length;
    const near = 4;
    const alphaPolys = [];
    while (i < n) {
      const face = rows[i][0], ent = rows[i][9];
      let m = 0;
      let behind = false;
      const j = i;
      while (i < n && rows[i][0] === face && rows[i][9] === ent) { if (rows[i][2] < near) behind = true; i++; m++; }
      if (m < 3) continue;
      const info = this.faceInfo.get(face);
      if (!info) continue;
      this.polyRoom(m);
      const vv = this.vv;
      for (let k = 0; k < m; k++) {
        const r = rows[j + k], o = k * 7;
        vv[o] = r[2]; vv[o + 1] = r[3]; vv[o + 2] = r[4]; vv[o + 3] = r[5]; vv[o + 4] = r[6]; vv[o + 5] = r[7]; vv[o + 6] = r[8];
      }
      this.emitPoly(m, behind, face, ent, info, styles, time, entFrames, alphaPolys);
    }
    this.drawAlphaPolys(alphaPolys, styles, time, entFrames);
  }

  /**
   * FRAME_FACES_FAST rows [face, ent_id, ox, oy, oz]: SQL chose the faces,
   * the vertices come from the BSP held here, transformed and projected
   * exactly as FRAME_FACES would.
   */
  drawFaceList(rows, styles, time, entFrames, entAngles = new Map()) {
    const view = this.view;
    const [fx, fy, fz] = view.fwd, [rx, ry, rz] = view.right, [ux, uy, uz] = view.up;
    const near = 4, sc = view.scale, cx = view.cx, cy = view.cy;
    const alphaPolys = [];
    let lastEnt = -1, M = null;
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const face = row[0], ent = row[1], ox = row[2], oy = row[3], oz = row[4];
      const info = this.faceInfo.get(face);
      if (!info) continue;
      const { bsp, f, ti } = info;
      const lx = view.x - ox, ly = view.y - oy, lz = view.z - oz;
      const verts = f.verts, vs = bsp.vertices, m = verts.length;
      if (m < 3) continue;
      if (ent !== lastEnt) { lastEnt = ent; M = ent && entAngles.get(ent) ? angleMatrix(entAngles.get(ent)) : null; }
      const s0 = ti.s[0], s1 = ti.s[1], s2 = ti.s[2], soff = ti.soff, t0 = ti.t[0], t1 = ti.t[1], t2 = ti.t[2], toff = ti.toff;
      this.polyRoom(m);
      const vv = this.vv;
      let behind = false;
      for (let k = 0; k < m; k++) {
        const vi = verts[k] * 3;
        const x = vs[vi], y = vs[vi + 1], z = vs[vi + 2];
        let dx, dy, dz;
        if (M) { dx = M[0] * x + M[1] * y + M[2] * z - lx; dy = M[3] * x + M[4] * y + M[5] * z - ly; dz = M[6] * x + M[7] * y + M[8] * z - lz; }
        else { dx = x - lx; dy = y - ly; dz = z - lz; }
        const vf = dx * fx + dy * fy + dz * fz, vr = dx * rx + dy * ry + dz * rz, vu = dx * ux + dy * uy + dz * uz;
        const o = k * 7;
        vv[o] = vf; vv[o + 1] = vr; vv[o + 2] = vu;
        if (vf >= near) { vv[o + 3] = cx + (vr * sc) / vf; vv[o + 4] = cy - (vu * sc) / vf; } else behind = true;
        vv[o + 5] = x * s0 + y * s1 + z * s2 + soff;
        vv[o + 6] = x * t0 + y * t1 + z * t2 + toff;
      }
      this.emitPoly(m, behind, face, ent, info, styles, time, entFrames, alphaPolys);
    }
    this.drawAlphaPolys(alphaPolys, styles, time, entFrames);
  }

  /**
   * The polygon in this.vv (m vertices of vf, vr, vu, sx, sy, s, t) becomes
   * screen-space vertices in this.pp (sx, sy, z, s, t), clipped to the near
   * plane if it crosses it, and is drawn — or kept for after the opaque
   * surfaces when translucent (R_DrawAlphaSurfaces).
   */
  emitPoly(m, behind, face, ent, info, styles, time, entFrames, alphaPolys) {
    const vv = this.vv, pp = this.pp;
    const view = this.view, near = 4;
    let n = 0;
    if (!behind) {
      for (let k = 0; k < m; k++) {
        const o = k * 7, q = k * 5;
        pp[q] = vv[o + 3]; pp[q + 1] = vv[o + 4]; pp[q + 2] = vv[o]; pp[q + 3] = vv[o + 5]; pp[q + 4] = vv[o + 6];
      }
      n = m;
    } else {
      for (let k = 0; k < m; k++) {
        const a = k * 7, b = ((k + 1) % m) * 7;
        const ain = vv[a] >= near, bin = vv[b] >= near;
        if (ain) { const q = n++ * 5; pp[q] = vv[a + 3]; pp[q + 1] = vv[a + 4]; pp[q + 2] = vv[a]; pp[q + 3] = vv[a + 5]; pp[q + 4] = vv[a + 6]; }
        if (ain !== bin) {
          const f = (near - vv[a]) / (vv[b] - vv[a]);
          const r = vv[a + 1] + (vv[b + 1] - vv[a + 1]) * f, u = vv[a + 2] + (vv[b + 2] - vv[a + 2]) * f;
          const q = n++ * 5;
          pp[q] = view.cx + (r * view.scale) / near; pp[q + 1] = view.cy - (u * view.scale) / near; pp[q + 2] = near;
          pp[q + 3] = vv[a + 5] + (vv[b + 5] - vv[a + 5]) * f; pp[q + 4] = vv[a + 6] + (vv[b + 6] - vv[a + 6]) * f;
        }
      }
      if (n < 3) return;
    }
    const flags = info.f.flags;
    if (flags & (SURF.TRANS33 | SURF.TRANS66)) { alphaPolys.push({ verts: pp.slice(0, n * 5), n, face, ent, flags, info }); return; }
    this.drawSurfacePoly(pp, n, face, ent, flags, info, styles, time, entFrames);
  }

  drawAlphaPolys(alphaPolys, styles, time, entFrames) {
    for (const a of alphaPolys) this.drawSurfacePoly(a.verts, a.n, a.face, a.ent, a.flags, a.info, styles, time, entFrames);
  }

  drawSurfacePoly(poly, n, face, ent, flags, info, styles, time, entFrames) {
    const blend = flags & SURF.TRANS33 ? 1 : flags & SURF.TRANS66 ? 2 : 0;
    if (flags & SURF.SKY) this.fillPolygon(poly, n, null, 2, time, 0, 0);
    else if (flags & SURF.WARP) {
      const tex = this.texture(info.ti.texture);
      const scroll = flags & SURF.FLOWING ? -128 * ((time * 0.25) % 1) : 0;
      let ws = tex.warp;
      if (!ws) ws = tex.warp = { data: tex.mips[0], w: tex.w, h: tex.h, smin: 0, tmin: 0, mask: (tex.w & (tex.w - 1)) === 0 && (tex.h & (tex.h - 1)) === 0 };
      this.fillPolygon(poly, n, ws, 1, time, blend, scroll);
    } else {
      const s = this.surface(face, styles, time, entFrames.get(ent) ?? 0);
      const scroll = flags & SURF.FLOWING ? -128 * ((time * 0.77) % 1) : 0;
      if (s) this.fillPolygon(poly, n, s, 0, time, blend, scroll);
    }
  }

  /**
   * Scan-convert a convex polygon: n vertices of [sx, sy, z, s, t] in poly.
   * mode 0: textured, 1: warp (unlit, rippling), 2: sky. blend 0 opaque,
   * 1 trans33, 2 trans66. 1/z, s/z and t/z are affine in screen space; the
   * texel coordinates are divided out every 16 pixels and stepped linearly
   * between (D_DrawSpans16), the depth test runs on every pixel.
   */
  fillPolygon(poly, n, surf, mode, time, blend, scroll) {
    const { w, h, edgeL, edgeR, fb, zb } = this;
    let ymin = Infinity, ymax = -Infinity;
    for (let k = 0; k < n; k++) { const py = poly[k * 5 + 1]; if (py < ymin) ymin = py; if (py > ymax) ymax = py; }
    const y0 = Math.max(0, Math.ceil(ymin - 0.5));
    const y1 = Math.min(h - 1, Math.ceil(ymax - 0.5) - 1);
    if (y0 > y1) return;
    for (let y = y0; y <= y1; y++) { edgeL[y * 5] = Infinity; edgeR[y * 5] = -Infinity; }
    for (let k = 0; k < n; k++) {
      const a = k * 5, b = ((k + 1) % n) * 5;
      let ax = poly[a], ay = poly[a + 1], bx = poly[b], by = poly[b + 1];
      if (ay === by) continue;
      let aiz = 1 / poly[a + 2], biz = 1 / poly[b + 2];
      let asz = poly[a + 3] * aiz, bsz = poly[b + 3] * biz, atz = poly[a + 4] * aiz, btz = poly[b + 4] * biz;
      if (ay > by) {
        let t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; t = aiz; aiz = biz; biz = t; t = asz; asz = bsz; bsz = t; t = atz; atz = btz; btz = t;
      }
      const dy = by - ay;
      const dx = (bx - ax) / dy, diz = (biz - aiz) / dy, dsz = (bsz - asz) / dy, dtz = (btz - atz) / dy;
      const ys = Math.max(y0, Math.ceil(ay - 0.5)), ye = Math.min(y1, Math.ceil(by - 0.5) - 1);
      for (let y = ys; y <= ye; y++) {
        const t = y + 0.5 - ay;
        const x = ax + dx * t;
        const o = y * 5;
        if (x < edgeL[o]) { edgeL[o] = x; edgeL[o + 1] = aiz + diz * t; edgeL[o + 2] = asz + dsz * t; edgeL[o + 3] = atz + dtz * t; }
        if (x > edgeR[o]) { edgeR[o] = x; edgeR[o + 1] = aiz + diz * t; edgeR[o + 2] = asz + dsz * t; edgeR[o + 3] = atz + dtz * t; }
      }
    }
    const view = this.view;
    if (mode === 2) {
      // the sky box, by each pixel's direction: the ray steps along the span
      const sky = this.sky;
      const fwd = view.fwd, right = view.right, up = view.up;
      const dk = 1 / view.scale;
      const sdx = right[0] * dk, sdy = right[1] * dk, sdz = right[2] * dk;
      for (let y = y0; y <= y1; y++) {
        const o = y * 5;
        const xl = edgeL[o], xr = edgeR[o];
        if (xl === Infinity || xr === -Infinity) continue;
        const xs = Math.max(0, Math.ceil(xl - 0.5)), xe = Math.min(w - 1, Math.ceil(xr - 0.5) - 1);
        if (xs > xe) continue;
        const kx = (xs + 0.5 - view.cx) * dk, ky = (view.cy - y - 0.5) * dk;
        let dx = fwd[0] + right[0] * kx + up[0] * ky, dy = fwd[1] + right[1] * kx + up[1] * ky, dz = fwd[2] + right[2] * kx + up[2] * ky;
        let idx = y * w + xs;
        for (let x = xs; x <= xe; x++, idx++, dx += sdx, dy += sdy, dz += sdz) {
          if (1e-6 > zb[idx]) {
            zb[idx] = 1e-6;
            fb[idx] = sky ? skyDir(sky, dx, dy, dz) : 0;
          }
        }
      }
      return;
    }
    const sd = surf.data;
    const sw = surf.w, sh = surf.h, smin = surf.smin - scroll, tmin = surf.tmin;
    const pow2 = surf.mask, swm = sw - 1, shm = sh - 1;
    const sin = this.sinTable;
    const tphase = (time * 20) & 255;
    const am = this.alphamap;
    const useBlend = blend && am;
    const cm = this.colormap;
    for (let y = y0; y <= y1; y++) {
      const o = y * 5;
      const xl = edgeL[o], xr = edgeR[o];
      if (xl === Infinity || xr === -Infinity) continue;
      const xs = Math.max(0, Math.ceil(xl - 0.5)), xe = Math.min(w - 1, Math.ceil(xr - 0.5) - 1);
      if (xs > xe) continue;
      const span = xr - xl || 1;
      const diz = (edgeR[o + 1] - edgeL[o + 1]) / span;
      const dsz = (edgeR[o + 2] - edgeL[o + 2]) / span;
      const dtz = (edgeR[o + 3] - edgeL[o + 3]) / span;
      const t0 = xs + 0.5 - xl;
      let iz = edgeL[o + 1] + diz * t0, sz = edgeL[o + 2] + dsz * t0, tz = edgeL[o + 3] + dtz * t0;
      let idx = y * w + xs;
      let z = 1 / iz, s = sz * z - smin, t = tz * z - tmin;
      let x = xs;
      while (x <= xe) {
        const run = xe - x + 1 < 16 ? xe - x + 1 : 16;
        const iz2 = iz + diz * run, sz2 = sz + dsz * run, tz2 = tz + dtz * run;
        z = 1 / iz2;
        const s2 = sz2 * z - smin, t2 = tz2 * z - tmin;
        const ds = (s2 - s) / run, dt = (t2 - t) / run;
        if (mode === 1) {
          for (let k = 0; k < run; k++, idx++, iz += diz, s += ds, t += dt) {
            if (iz <= zb[idx]) continue;
            // D_DrawTurbulent8Span: each axis rippled by the other
            let ss = s + sin[(tphase + (t >> 0)) & 255], tt = t + sin[(tphase + (s >> 0)) & 255];
            let si, ti;
            if (pow2) { si = Math.floor(ss) & swm; ti = Math.floor(tt) & shm; }
            else { si = (((ss % sw) + sw) % sw) | 0; ti = (((tt % sh) + sh) % sh) | 0; }
            let c = cm[(8 << 8) | sd[ti * sw + si]];   // unlit water, slightly dimmed
            if (useBlend) { const d = fb[idx]; fb[idx] = blend === 1 ? am[d + (c << 8)] : am[(d << 8) + c]; continue; }
            zb[idx] = iz;
            fb[idx] = c;
          }
        } else if (useBlend) {
          for (let k = 0; k < run; k++, idx++, iz += diz, s += ds, t += dt) {
            if (iz <= zb[idx]) continue;
            let si = s | 0, ti = t | 0;
            if (si < 0) si = 0; else if (si >= sw) si = swm;
            if (ti < 0) ti = 0; else if (ti >= sh) ti = shm;
            const c = sd[ti * sw + si], d = fb[idx];
            fb[idx] = blend === 1 ? am[d + (c << 8)] : am[(d << 8) + c];   // translucent surfaces don't write depth
          }
        } else {
          for (let k = 0; k < run; k++, idx++, iz += diz, s += ds, t += dt) {
            if (iz <= zb[idx]) continue;
            let si = s | 0, ti = t | 0;
            if (si < 0) si = 0; else if (si >= sw) si = swm;
            if (ti < 0) ti = 0; else if (ti >= sh) ti = shm;
            zb[idx] = iz;
            fb[idx] = sd[ti * sw + si];
          }
        }
        x += run; iz = iz2; sz = sz2; tz = tz2; s = s2; t = t2;
      }
    }
  }

  // ── alias models (R_AliasDrawModel) ─────────────────────────────────────
  /** Room for n transformed vertices: vf, vr, vu, px, py, iz, light (stride 7). */
  aliasRoom(n) {
    if (this.av.length < n * 7) this.av = new Float32Array(n * 7 * 2);
  }

  /**
   * Draw an MD2 at origin with Quake angles (pitch positive up as
   * vectoangles gives it). light: 0..255 from the lightmap below the entity.
   * Every vertex is transformed, lit and projected once; triangles that
   * cross the near plane are clipped one by one.
   */
  drawAlias(mdl, frameIndex, skin, origin, angles, light, opts = {}) {
    const view = this.view;
    const pitch = (angles[0] * Math.PI) / 180, yaw = (angles[1] * Math.PI) / 180, roll = (angles[2] * Math.PI) / 180;
    const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(-pitch), cp = Math.cos(-pitch), sr = Math.sin(roll), cr = Math.cos(roll);
    const F0 = cp * cy, F1 = cp * sy, F2 = -sp;
    const R0 = -sr * sp * cy + cr * sy, R1 = -sr * sp * sy - cr * cy, R2 = -sr * cp;
    const U0 = cr * sp * cy + sr * sy, U1 = cr * sp * sy - sr * cy, U2 = cr * cp;
    const frame = mdl.frames[Math.min(Math.max(frameIndex | 0, 0), mdl.frames.length - 1)];
    const verts = frame.verts;
    const scx = frame.scale[0], scy = frame.scale[1], scz = frame.scale[2];
    const trx = frame.translate[0], try_ = frame.translate[1], trz = frame.translate[2];
    const n = mdl.numVerts;
    this.aliasRoom(n);
    const av = this.av;
    const near = opts.near ?? 4;
    const ox = origin[0] - view.x, oy = origin[1] - view.y, oz = origin[2] - view.z;
    const fwd = view.fwd, right = view.right, up = view.up;
    const fx = fwd[0], fy = fwd[1], fz = fwd[2], rx = right[0], ry = right[1], rz = right[2], ux = up[0], uy = up[1], uz = up[2];
    const ldx = -1, ldz = 1;
    light = Math.min(255, light * this.lightScale);
    const ambient = Math.max(light, 8), shade = Math.max(light, 8);
    const depthHack = opts.depthHack ? 3 : 1;
    const vcx = view.cx, vcy = view.cy, sc = view.scale;
    let anyNear = false;
    for (let i = 0; i < n; i++) {
      const mx = verts[i * 4] * scx + trx;
      const my = verts[i * 4 + 1] * scy + try_;
      const mz = verts[i * 4 + 2] * scz + trz;
      const wx = ox + F0 * mx - R0 * my + U0 * mz;
      const wy = oy + F1 * mx - R1 * my + U1 * mz;
      const wz = oz + F2 * mx - R2 * my + U2 * mz;
      const f = wx * fx + wy * fy + wz * fz;
      const r = wx * rx + wy * ry + wz * rz, u = wx * ux + wy * uy + wz * uz;
      const o = i * 7;
      av[o] = f; av[o + 1] = r; av[o + 2] = u;
      if (f < near) anyNear = true;
      else { av[o + 3] = vcx + (r * sc) / f; av[o + 4] = vcy - (u * sc) / f; av[o + 5] = (1 / f) * depthHack; }
      const ni = Math.min(verts[i * 4 + 3], 161) * 3;
      const a0 = ANORMS[ni], a1 = ANORMS[ni + 1], a2 = ANORMS[ni + 2];
      const nx = F0 * a0 - R0 * a1 + U0 * a2;
      const nz = F2 * a0 - R2 * a1 + U2 * a2;
      const d = (nx * ldx + nz * ldz) * 0.7071;
      av[o + 6] = Math.min(255, ambient + shade * Math.max(0, d));
    }
    const sk = mdl.skins[Math.min(skin, mdl.skins.length - 1)] ?? mdl.skins[0];
    const skinData = sk.data, skinW = sk.w, skinH = sk.h;
    const tris = mdl.tris, st = mdl.st;
    const transparent = opts.transparent ? 255 : -1;
    const noZ = opts.noZTest, alpha = opts.alpha, shell = opts.shell;
    for (let t = 0; t < mdl.numTris; t++) {
      const ia = tris[t * 6] * 7, ib = tris[t * 6 + 1] * 7, ic = tris[t * 6 + 2] * 7;
      const ta = tris[t * 6 + 3] * 2, tb = tris[t * 6 + 4] * 2, tc = tris[t * 6 + 5] * 2;
      if (av[ia] >= near && av[ib] >= near && av[ic] >= near) {
        const ax = av[ia + 3], ay = av[ia + 4], bx = av[ib + 3], by = av[ib + 4], cx = av[ic + 3], cy = av[ic + 4];
        if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) <= 0) continue;   // back face (MD2 winding)
        this.triangle(ax, ay, av[ia + 5], st[ta], st[ta + 1], av[ia + 6], bx, by, av[ib + 5], st[tb], st[tb + 1], av[ib + 6],
          cx, cy, av[ic + 5], st[tc], st[tc + 1], av[ic + 6], skinData, skinW, skinH, transparent, noZ, alpha, shell);
        continue;
      }
      if (av[ia] < near && av[ib] < near && av[ic] < near) continue;
      // clip against the near plane in view space, then project the pieces
      const A = [av[ia], av[ia + 1], av[ia + 2], st[ta], st[ta + 1], av[ia + 6]];
      const B = [av[ib], av[ib + 1], av[ib + 2], st[tb], st[tb + 1], av[ib + 6]];
      const C = [av[ic], av[ic + 1], av[ic + 2], st[tc], st[tc + 1], av[ic + 6]];
      const inp = [A, B, C], out = [];
      for (let k = 0; k < 3; k++) {
        const P = inp[k], Q = inp[(k + 1) % 3];
        const pin = P[0] >= near, qin = Q[0] >= near;
        if (pin) out.push(P);
        if (pin !== qin) {
          const kk = (near - P[0]) / (Q[0] - P[0]);
          out.push([near, P[1] + (Q[1] - P[1]) * kk, P[2] + (Q[2] - P[2]) * kk, P[3] + (Q[3] - P[3]) * kk, P[4] + (Q[4] - P[4]) * kk, P[5] + (Q[5] - P[5]) * kk]);
        }
      }
      const proj = (v) => [vcx + (v[1] * sc) / v[0], vcy - (v[2] * sc) / v[0], (1 / v[0]) * depthHack, v[3], v[4], v[5]];
      const drawTri = (P, Q, S) => {
        const a = proj(P), b = proj(Q), c = proj(S);
        if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 0) return;
        this.triangle(a[0], a[1], a[2], a[3], a[4], a[5], b[0], b[1], b[2], b[3], b[4], b[5], c[0], c[1], c[2], c[3], c[4], c[5], skinData, skinW, skinH, transparent, noZ, alpha, shell);
      };
      drawTri(out[0], out[1], out[2]);
      if (out.length === 4) drawTri(out[0], out[2], out[3]);
    }
    return anyNear;
  }

  /** One edge of a triangle into the scanline tables (x, 1/z, s, t, light). */
  triEdge(ya, yb, ax, ay, aiz, as, at, al, bx, by, biz, bs, bt, bl) {
    if (ay === by) return;
    if (ay > by) {
      let t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; t = aiz; aiz = biz; biz = t;
      t = as; as = bs; bs = t; t = at; at = bt; bt = t; t = al; al = bl; bl = t;
    }
    const { edgeL, edgeR } = this;
    const dy = by - ay;
    const dx = (bx - ax) / dy, diz = (biz - aiz) / dy, ds = (bs - as) / dy, dt = (bt - at) / dy, dl = (bl - al) / dy;
    const ys = Math.max(ya, Math.ceil(ay - 0.5)), ye = Math.min(yb, Math.ceil(by - 0.5) - 1);
    for (let y = ys; y <= ye; y++) {
      const t = y + 0.5 - ay, x = ax + dx * t, o = y * 5;
      if (x < edgeL[o]) { edgeL[o] = x; edgeL[o + 1] = aiz + diz * t; edgeL[o + 2] = as + ds * t; edgeL[o + 3] = at + dt * t; edgeL[o + 4] = al + dl * t; }
      if (x > edgeR[o]) { edgeR[o] = x; edgeR[o + 1] = aiz + diz * t; edgeR[o + 2] = as + ds * t; edgeR[o + 3] = at + dt * t; edgeR[o + 4] = al + dl * t; }
    }
  }

  /** A Gouraud-lit, affine-textured triangle with z-test. shell: a flat colour instead of the skin. */
  triangle(x0, y0, iz0, s0, t0, l0, x1, y1, iz1, s1, t1, l1, x2, y2, iz2, s2, t2, l2, tex, tw, th, transparent, noZ, alpha, shell) {
    const { w, h, edgeL, edgeR, fb, zb, colormap } = this;
    const ymin = Math.min(y0, y1, y2), ymax = Math.max(y0, y1, y2);
    const ya = Math.max(0, Math.ceil(ymin - 0.5)), yb = Math.min(h - 1, Math.ceil(ymax - 0.5) - 1);
    if (ya > yb) return;
    for (let y = ya; y <= yb; y++) { edgeL[y * 5] = Infinity; edgeR[y * 5] = -Infinity; }
    this.triEdge(ya, yb, x0, y0, iz0, s0, t0, l0, x1, y1, iz1, s1, t1, l1);
    this.triEdge(ya, yb, x1, y1, iz1, s1, t1, l1, x2, y2, iz2, s2, t2, l2);
    this.triEdge(ya, yb, x2, y2, iz2, s2, t2, l2, x0, y0, iz0, s0, t0, l0);
    const am = this.alphamap;
    const blend = alpha && am;
    const flat = shell != null;
    for (let y = ya; y <= yb; y++) {
      const o = y * 5, xl = edgeL[o], xr = edgeR[o];
      if (xl === Infinity) continue;
      const xs = Math.max(0, Math.ceil(xl - 0.5)), xe = Math.min(w - 1, Math.ceil(xr - 0.5) - 1);
      if (xs > xe) continue;
      const span = xr - xl || 1;
      const diz = (edgeR[o + 1] - edgeL[o + 1]) / span, ds = (edgeR[o + 2] - edgeL[o + 2]) / span;
      const dt = (edgeR[o + 3] - edgeL[o + 3]) / span, dl = (edgeR[o + 4] - edgeL[o + 4]) / span;
      const tt = xs + 0.5 - xl;
      let iz = edgeL[o + 1] + diz * tt, s = edgeL[o + 2] + ds * tt, t = edgeL[o + 3] + dt * tt, l = edgeL[o + 4] + dl * tt;
      let idx = y * w + xs;
      for (let x = xs; x <= xe; x++, idx++, iz += diz, s += ds, t += dt, l += dl) {
        if (!noZ && iz <= zb[idx]) continue;
        let si = s | 0, ti = t | 0;
        if (si < 0) si = 0; else if (si >= tw) si = tw - 1;
        if (ti < 0) ti = 0; else if (ti >= th) ti = th - 1;
        const c = flat ? shell : tex[ti * tw + si];
        if (c === transparent) continue;
        zb[idx] = iz;
        let sh = (255 - l) >> 2;
        if (sh < 0) sh = 0; else if (sh > 63) sh = 63;
        const lit = colormap[(sh << 8) | c];
        fb[idx] = blend ? am[fb[idx] + (lit << 8)] : lit;
      }
    }
  }

  // ── sprites ─────────────────────────────────────────────────────────────
  drawSprite(spr, frameIndex, origin, light = 255, alpha = false) {
    const view = this.view;
    const fr = spr.frames[Math.min(frameIndex | 0, spr.frames.length - 1)];
    if (!fr || !fr.data) return;
    const wx = origin[0] - view.x, wy = origin[1] - view.y, wz = origin[2] - view.z;
    const f = wx * view.fwd[0] + wy * view.fwd[1] + wz * view.fwd[2];
    if (f < 4) return;
    const r = wx * view.right[0] + wy * view.right[1] + wz * view.right[2];
    const u = wx * view.up[0] + wy * view.up[1] + wz * view.up[2];
    const iz = 1 / f, k = view.scale * iz;
    const left = r + fr.ox, right = left + fr.w, top = u + fr.oy, bottom = top - fr.h;
    const x0 = view.cx + left * k, x1 = view.cx + right * k, y0 = view.cy - top * k, y1 = view.cy - bottom * k;
    this.triangle(x0, y0, iz, 0, 0, light, x1, y0, iz, fr.w, 0, light, x1, y1, iz, fr.w, fr.h, light, fr.data, fr.w, fr.h, 255, false, alpha);
    this.triangle(x0, y0, iz, 0, 0, light, x1, y1, iz, fr.w, fr.h, light, x0, y1, iz, 0, fr.h, light, fr.data, fr.w, fr.h, 255, false, alpha);
  }

  // ── particles (cl_fx.c, the parts we need) ───────────────────────────────
  spawnParticles(kind, x, y, z, n, dir = [0, 0, 0], color = 0) {
    const now = this.time ?? 0;
    const add = (p) => this.particles.push(p);
    const rnd = () => Math.random() * 2 - 1;
    if (kind === 'explosion') {
      for (let i = 0; i < 128; i++) add({ x: x + rnd() * 16, y: y + rnd() * 16, z: z + rnd() * 16, vx: rnd() * 256, vy: rnd() * 256, vz: rnd() * 256,
        color: (i & 1 ? 111 : 103) + (i % 4), die: now + 4 * Math.random() + 1, type: i & 1 ? 'explode' : 'explode2', ramp: i & 3 });
    } else if (kind === 'bfg') {
      for (let i = 0; i < 128; i++) add({ x: x + rnd() * 16, y: y + rnd() * 16, z: z + rnd() * 16, vx: rnd() * 192, vy: rnd() * 192, vz: rnd() * 192,
        color: 0xd0 + (i & 7), die: now + 0.6 + Math.random() * 0.4, type: 'grav' });
    } else if (kind === 'teleport') {
      for (let i = -16; i < 16; i += 4) for (let j = -16; j < 16; j += 4) for (let k = -24; k < 32; k += 4) {
        const dl = Math.hypot(j, i, k) || 1;
        const v = 50 + Math.random() * 64;
        add({ x: x + i + Math.random() * 4, y: y + j + Math.random() * 4, z: z + k + Math.random() * 4, vx: (j / dl) * v, vy: (i / dl) * v, vz: (k / dl) * v,
          color: 7 + Math.floor(Math.random() * 8), die: now + 0.2 + Math.random() * 0.1, type: 'slowgrav' });
      }
    } else if (kind === 'bubbles') {
      // CL_BubbleTrail: a grey bubble every 32 units, drifting up for about a second
      const [x2, y2, z2] = dir;
      const dx = x2 - x, dy = y2 - y, dz = z2 - z;
      const len = Math.hypot(dx, dy, dz);
      for (let i = 0; i < len; i += 32) {
        const k = len ? i / len : 0;
        add({ x: x + dx * k + rnd() * 2, y: y + dy * k + rnd() * 2, z: z + dz * k + rnd() * 2, vx: rnd() * 5, vy: rnd() * 5, vz: rnd() * 5 + 6,
          color: 4 + Math.floor(Math.random() * 8), die: now + 1 / (1 + Math.random() * 0.2), type: 'still' });
      }
    } else if (kind === 'rail') {
      // CL_RailTrail: a blue spiral around the beam, white core
      const [x2, y2, z2] = dir;
      const dx = x2 - x, dy = y2 - y, dz = z2 - z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const nx = dx / len, ny = dy / len, nz = dz / len;
      // perpendicular
      let px = -ny, py = nx, pz = 0;
      if (Math.abs(nz) > 0.9) { px = 1; py = 0; pz = 0; }
      const ux = ny * pz - nz * py, uy = nz * px - nx * pz, uz = nx * py - ny * px;
      for (let i = 0; i < len; i += 1) {
        const a = i * 0.1, c = Math.cos(a) * 3, s = Math.sin(a) * 3;
        add({ x: x + nx * i + px * c + ux * s, y: y + ny * i + py * c + uy * s, z: z + nz * i + pz * c + uz * s, vx: 0, vy: 0, vz: 0,
          color: 0x74 + (i & 7), die: now + 1 + Math.random() * 0.2, type: 'still' });
        if ((i & 1) === 0) add({ x: x + nx * i + rnd() * 1.5, y: y + ny * i + rnd() * 1.5, z: z + nz * i + rnd() * 1.5, vx: rnd() * 3, vy: rnd() * 3, vz: rnd() * 3,
          color: 0x0f - (i & 3), die: now + 0.6 + Math.random() * 0.2, type: 'still' });
      }
    } else {
      // gunshot / blood / blaster sparks: n particles at the impact
      const scale = n > 130 ? 3 : n > 20 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        add({ x: x + rnd() * 4 * scale, y: y + rnd() * 4 * scale, z: z + rnd() * 4 * scale, vx: dir[0] * 40 + rnd() * 20, vy: dir[1] * 40 + rnd() * 20, vz: dir[2] * 40 + rnd() * 20,
          color: (color & ~7) + Math.floor(Math.random() * 8), die: now + 0.1 * (Math.random() * 5 + 1), type: kind === 'blood' ? 'grav' : 'slowgrav' });
      }
    }
  }

  runParticles(dt, time) {
    this.time = time;
    const ps = this.particles;
    const grav = 800 * dt;
    let k = 0;
    for (const p of ps) {
      if (p.die < time) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      switch (p.type) {
        case 'explode': p.ramp += dt * 10; if (p.ramp >= 6) p.die = -1; else p.color = [0x6f, 0x6d, 0x6b, 0x69, 0x67, 0x65][p.ramp | 0]; p.vz -= grav; p.vx += p.vx * dt * 4; p.vy += p.vy * dt * 4; p.vz += p.vz * dt * 4; break;
        case 'explode2': p.ramp += dt * 15; if (p.ramp >= 8) p.die = -1; else p.color = [0x6f, 0x6e, 0x6d, 0x6c, 0x6b, 0x6a, 0x68, 0x66][p.ramp | 0]; p.vz -= grav; p.vx -= p.vx * dt; p.vy -= p.vy * dt; p.vz -= p.vz * dt; break;
        case 'grav': p.vz -= grav; break;
        case 'slowgrav': p.vz -= grav * 0.05; break;
        default: break;
      }
      ps[k++] = p;
    }
    ps.length = k;
  }

  drawParticles() {
    const view = this.view;
    const { fb, zb, w, h } = this;
    for (const p of this.particles) {
      const wx = p.x - view.x, wy = p.y - view.y, wz = p.z - view.z;
      const f = wx * view.fwd[0] + wy * view.fwd[1] + wz * view.fwd[2];
      if (f < 4) continue;
      const iz = 1 / f;
      const x = (view.cx + ((wx * view.right[0] + wy * view.right[1] + wz * view.right[2]) * view.scale) / f) | 0;
      const y = (view.cy - ((wx * view.up[0] + wy * view.up[1] + wz * view.up[2]) * view.scale) / f) | 0;
      const size = f < 200 ? 2 : 1;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
        const px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const idx = py * w + px;
        if (iz > zb[idx]) { zb[idx] = iz; fb[idx] = p.color; }
      }
    }
  }

  /** A line of pixels in 3D (the blaster bolt's glow, laser beams). */
  drawBeam(a, b, color, width = 2) {
    const view = this.view;
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d) || 1;
    const steps = Math.ceil(len / 2);
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      this.particles.push({ x: a[0] + d[0] * k, y: a[1] + d[1] * k, z: a[2] + d[2] * k, vx: 0, vy: 0, vz: 0, color, die: (this.time ?? 0) + 0.05, type: 'still', size: width });
    }
  }

  // ── 2D (draw.c) ─────────────────────────────────────────────────────────
  drawPic(pic, x, y) {
    if (!pic) return;
    const { fb, w, h } = this;
    for (let j = 0; j < pic.h; j++) {
      const py = y + j;
      if (py < 0 || py >= h) continue;
      for (let i = 0; i < pic.w; i++) {
        const px = x + i;
        if (px < 0 || px >= w) continue;
        const c = pic.data[j * pic.w + i];
        if (c !== 255) fb[py * w + px] = c;
      }
    }
  }

  drawChar(conchars, c, x, y) {
    if (c === 32 || c === 160 || !conchars) return;
    const { fb, w, h } = this;
    const cx = (c & 15) * 8, cy = (c >> 4) * 8;
    for (let j = 0; j < 8; j++) {
      const py = y + j;
      if (py < 0 || py >= h) continue;
      for (let i = 0; i < 8; i++) {
        const px = x + i;
        if (px < 0 || px >= w) continue;
        const col = conchars.data[(cy + j) * 128 + cx + i];
        if (col !== 255) fb[py * w + px] = col;
      }
    }
  }

  drawString(conchars, s, x, y, alt = false) {
    for (let i = 0; i < s.length; i++) this.drawChar(conchars, (s.charCodeAt(i) & 127) + (alt ? 128 : 0), x + i * 8, y);
  }

  fillRect(x, y, rw, rh, c) {
    const { fb, w, h } = this;
    for (let j = Math.max(0, y); j < Math.min(h, y + rh); j++) for (let i = Math.max(0, x); i < Math.min(w, x + rw); i++) fb[j * w + i] = c;
  }

  fade(x, y, rw, rh) {
    const { fb, w, h, colormap } = this;
    for (let j = Math.max(0, y); j < Math.min(h, y + rh); j++) for (let i = Math.max(0, x); i < Math.min(w, x + rw); i++) fb[j * w + i] = colormap[(40 << 8) | fb[j * w + i]];
  }

  /** A picture scaled over the whole framebuffer (nearest texel). */
  drawPicFull(pic) {
    const { fb, w, h } = this;
    for (let y = 0; y < h; y++) {
      const sy = Math.min(pic.h - 1, Math.floor((y * pic.h) / h)) * pic.w;
      for (let x = 0; x < w; x++) fb[y * w + x] = pic.data[sy + Math.min(pic.w - 1, Math.floor((x * pic.w) / w))];
    }
  }

  /** Convert palette indices to pixels, with a colour blend; `palette24` (768 bytes) overrides the game's palette. */
  present(tint = null, palette24 = null) {
    let pal = this.palette;
    if (palette24) {
      pal = this.picPal ?? (this.picPal = new Uint32Array(256));
      for (let i = 0; i < 256; i++) pal[i] = (255 << 24) | (palette24[i * 3 + 2] << 16) | (palette24[i * 3 + 1] << 8) | palette24[i * 3];
    }
    let p = pal;
    if (tint && tint[3] > 0) {
      p = this.tintPal ?? (this.tintPal = new Uint32Array(256));
      const a = tint[3], ia = 1 - a;
      for (let i = 0; i < 256; i++) {
        const c = pal[i];
        const r = (c & 255) * ia + tint[0] * a, g = ((c >> 8) & 255) * ia + tint[1] * a, b = ((c >> 16) & 255) * ia + tint[2] * a;
        p[i] = (255 << 24) | (b << 16) | (g << 8) | r;
      }
    }
    const { fb, pixels } = this;
    for (let i = 0; i < fb.length; i++) pixels[i] = p[fb[i]];
    this.ctx.putImageData(this.image, 0, 0);
  }
}

/** AngleVectors as a matrix with the columns forward, -right, up (the game's convention for brush models). */
export function angleMatrix([pitch, yaw, roll]) {
  const sy = Math.sin((yaw * Math.PI) / 180), cy = Math.cos((yaw * Math.PI) / 180);
  const sp = Math.sin((pitch * Math.PI) / 180), cp = Math.cos((pitch * Math.PI) / 180);
  const sr = Math.sin((roll * Math.PI) / 180), cr = Math.cos((roll * Math.PI) / 180);
  return [cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy, cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy, -sp, sr * cp, cr * cp];
}

/** The sky box: pick the face by the ray direction's major axis (R_DrawSkyBox's vec_to_st). */
function skyDir(sky, dx, dy, dz) {
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  let axis, s, t;
  if (ax >= ay && ax >= az) {
    if (dx > 0) { axis = 0; s = -dy / dx; t = dz / dx; } else { axis = 1; s = dy / -dx; t = dz / -dx; }
  } else if (ay >= az) {
    if (dy > 0) { axis = 2; s = dx / dy; t = dz / dy; } else { axis = 3; s = -dx / -dy; t = dz / -dy; }
  } else if (dz > 0) { axis = 4; s = -dy / dz; t = -dx / dz; } else { axis = 5; s = -dy / -dz; t = dx / -dz; }
  const face = sky[axis];
  let u = ((s + 1) * 0.5 * face.w) | 0, v = ((1 - (t + 1) * 0.5) * face.h) | 0;
  if (u < 0) u = 0; else if (u >= face.w) u = face.w - 1;
  if (v < 0) v = 0; else if (v >= face.h) v = face.h - 1;
  return face.data[v * face.w + u];
}

/** R_LightPoint: the lightmap value of the floor below a point (for models). */
export function lightPoint(bsp, x, y, z) {
  let best = 255;
  const rec = (node, sx, sy, sz, ex, ey, ez) => {
    if (node < 0) return -1;
    const n = bsp.nodes[node];
    const pl = bsp.planes[n.plane];
    const front = sx * pl.nx + sy * pl.ny + sz * pl.nz - pl.dist;
    const back = ex * pl.nx + ey * pl.ny + ez * pl.nz - pl.dist;
    const side = front < 0 ? 1 : 0;
    if ((back < 0) === (front < 0)) return rec(n.children[side], sx, sy, sz, ex, ey, ez);
    const frac = front / (front - back);
    const mx = sx + (ex - sx) * frac, my = sy + (ey - sy) * frac, mz = sz + (ez - sz) * frac;
    const r = rec(n.children[side], sx, sy, sz, mx, my, mz);
    if (r >= 0) return r;
    if ((back < 0) === side) return -1;
    for (let i = 0; i < n.numFaces; i++) {
      const f = bsp.faces[n.firstFace + i];
      if (f.flags & (SURF.SKY | SURF.WARP | SURF.NODRAW)) continue;
      const ti = bsp.texinfo[f.texinfo];
      const s = mx * ti.s[0] + my * ti.s[1] + mz * ti.s[2] + ti.soff;
      const t = mx * ti.t[0] + my * ti.t[1] + mz * ti.t[2] + ti.toff;
      if (s < f.texturemins[0] || t < f.texturemins[1]) continue;
      const ds = s - f.texturemins[0], dt = t - f.texturemins[1];
      if (ds > f.extents[0] || dt > f.extents[1]) continue;
      if (f.lightofs < 0) return 255;
      const lw = f.lightW;
      const off = f.lightofs + (dt >> 4) * lw + (ds >> 4);
      return bsp.lightdata[off] ?? 0;
    }
    return rec(n.children[side ^ 1], mx, my, mz, ex, ey, ez);
  };
  const r = rec(bsp.models[0].headnode, x, y, z, x, y, z - 2048);
  if (r >= 0) best = r;
  return best;
}
