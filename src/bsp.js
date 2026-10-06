// bsp.js – Quake 2 BSP version 38 (IBSP). Everything the SQL side needs is
// produced as plain arrays; what only the painter needs (lightmaps, the
// vertex order of each face) stays here.
//
// Against Quake 1: textures are external (.wal, named by texinfo), the
// lightmaps are RGB (collapsed to a grey level like ref_soft did), there are
// no clipnodes – collision is against the BRUSHES of each LEAF – and the
// PVS is per CLUSTER of leaves.

import { cstr } from './pak.js';

const LUMP = {
  entities: 0, planes: 1, vertices: 2, visibility: 3, nodes: 4, texinfo: 5, faces: 6, lighting: 7, leaves: 8,
  leaffaces: 9, leafbrushes: 10, edges: 11, surfedges: 12, models: 13, brushes: 14, brushsides: 15, pop: 16, areas: 17, areaportals: 18,
};

export const CONTENTS = {
  SOLID: 1, WINDOW: 2, AUX: 4, LAVA: 8, SLIME: 16, WATER: 32, MIST: 64, AREAPORTAL: 0x8000, PLAYERCLIP: 0x10000, MONSTERCLIP: 0x20000,
  ORIGIN: 0x1000000, MONSTER: 0x2000000, DEADMONSTER: 0x4000000, DETAIL: 0x8000000, TRANSLUCENT: 0x10000000, LADDER: 0x20000000,
};
export const SURF = { LIGHT: 1, SLICK: 2, SKY: 4, WARP: 8, TRANS33: 0x10, TRANS66: 0x20, FLOWING: 0x40, NODRAW: 0x80 };

export class Bsp {
  constructor(buffer, name = '') {
    this.name = name;
    const dv = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    this.bytes = bytes;
    if (cstr(bytes, 0, 4) !== 'IBSP') throw new Error(`${name}: not an IBSP file`);
    const version = dv.getInt32(4, true);
    if (version !== 38) throw new Error(`${name}: BSP version ${version}, expected 38`);
    const lump = (i) => ({ off: dv.getInt32(8 + i * 8, true), len: dv.getInt32(12 + i * 8, true) });

    const el = lump(LUMP.entities);
    this.entityText = cstr(bytes, el.off, el.len);
    this.entities = parseEntities(this.entityText);

    let l = lump(LUMP.planes);
    this.planes = [];
    for (let p = l.off; p < l.off + l.len; p += 20) {
      this.planes.push({ nx: dv.getFloat32(p, true), ny: dv.getFloat32(p + 4, true), nz: dv.getFloat32(p + 8, true), dist: dv.getFloat32(p + 12, true), type: dv.getInt32(p + 16, true) });
    }

    l = lump(LUMP.vertices);
    this.vertices = new Float32Array(bytes.buffer.slice(l.off, l.off + l.len));

    l = lump(LUMP.visibility);
    const visOff = l.off, visLen = l.len;

    l = lump(LUMP.nodes);
    this.nodes = [];
    for (let p = l.off; p < l.off + l.len; p += 28) {
      this.nodes.push({
        plane: dv.getInt32(p, true), children: [dv.getInt32(p + 4, true), dv.getInt32(p + 8, true)],
        mins: [dv.getInt16(p + 12, true), dv.getInt16(p + 14, true), dv.getInt16(p + 16, true)],
        maxs: [dv.getInt16(p + 18, true), dv.getInt16(p + 20, true), dv.getInt16(p + 22, true)],
        firstFace: dv.getUint16(p + 24, true), numFaces: dv.getUint16(p + 26, true),
      });
    }

    l = lump(LUMP.texinfo);
    this.texinfo = [];
    for (let p = l.off; p < l.off + l.len; p += 76) {
      this.texinfo.push({
        s: [dv.getFloat32(p, true), dv.getFloat32(p + 4, true), dv.getFloat32(p + 8, true)], soff: dv.getFloat32(p + 12, true),
        t: [dv.getFloat32(p + 16, true), dv.getFloat32(p + 20, true), dv.getFloat32(p + 24, true)], toff: dv.getFloat32(p + 28, true),
        flags: dv.getInt32(p + 32, true), value: dv.getInt32(p + 36, true),
        texture: cstr(bytes, p + 40, 32).toLowerCase(), next: dv.getInt32(p + 72, true),
      });
    }
    // the distinct texture names, in texinfo order: the painter loads textures/<name>.wal
    this.textureNames = [];
    const tindex = new Map();
    for (const ti of this.texinfo) {
      if (!tindex.has(ti.texture)) { tindex.set(ti.texture, this.textureNames.length); this.textureNames.push(ti.texture); }
      ti.tex = tindex.get(ti.texture);
    }

    l = lump(LUMP.faces);
    this.faces = [];
    for (let p = l.off; p < l.off + l.len; p += 20) {
      this.faces.push({
        plane: dv.getUint16(p, true), side: dv.getInt16(p + 2, true),
        firstEdge: dv.getInt32(p + 4, true), numEdges: dv.getInt16(p + 8, true), texinfo: dv.getInt16(p + 10, true),
        styles: [bytes[p + 12], bytes[p + 13], bytes[p + 14], bytes[p + 15]], lightofs: dv.getInt32(p + 16, true),
      });
    }

    // lighting: RGB → the brightest channel, as ref_soft's Mod_LoadLighting
    l = lump(LUMP.lighting);
    const nl = (l.len / 3) | 0;
    this.lightdata = new Uint8Array(nl);
    for (let i = 0, p = l.off; i < nl; i++, p += 3) {
      const r = bytes[p], g = bytes[p + 1], b = bytes[p + 2];
      this.lightdata[i] = r >= g && r >= b ? r : g >= b ? g : b;
    }
    for (const f of this.faces) if (f.lightofs >= 0) f.lightofs = (f.lightofs / 3) | 0;

    l = lump(LUMP.leaves);
    this.leaves = [];
    for (let p = l.off; p < l.off + l.len; p += 28) {
      this.leaves.push({
        contents: dv.getInt32(p, true), cluster: dv.getInt16(p + 4, true), area: dv.getInt16(p + 6, true),
        mins: [dv.getInt16(p + 8, true), dv.getInt16(p + 10, true), dv.getInt16(p + 12, true)],
        maxs: [dv.getInt16(p + 14, true), dv.getInt16(p + 16, true), dv.getInt16(p + 18, true)],
        firstLeafFace: dv.getUint16(p + 20, true), numLeafFaces: dv.getUint16(p + 22, true),
        firstLeafBrush: dv.getUint16(p + 24, true), numLeafBrushes: dv.getUint16(p + 26, true),
      });
    }

    l = lump(LUMP.leaffaces);
    this.leaffaces = new Uint16Array(bytes.buffer.slice(l.off, l.off + l.len));
    l = lump(LUMP.leafbrushes);
    this.leafbrushes = new Uint16Array(bytes.buffer.slice(l.off, l.off + l.len));
    l = lump(LUMP.edges);
    this.edges = new Uint16Array(bytes.buffer.slice(l.off, l.off + l.len));
    l = lump(LUMP.surfedges);
    this.surfedges = new Int32Array(bytes.buffer.slice(l.off, l.off + l.len));

    l = lump(LUMP.models);
    this.models = [];
    for (let p = l.off; p < l.off + l.len; p += 48) {
      this.models.push({
        mins: [dv.getFloat32(p, true), dv.getFloat32(p + 4, true), dv.getFloat32(p + 8, true)],
        maxs: [dv.getFloat32(p + 12, true), dv.getFloat32(p + 16, true), dv.getFloat32(p + 20, true)],
        origin: [dv.getFloat32(p + 24, true), dv.getFloat32(p + 28, true), dv.getFloat32(p + 32, true)],
        headnode: dv.getInt32(p + 36, true), firstFace: dv.getInt32(p + 40, true), numFaces: dv.getInt32(p + 44, true),
      });
    }

    l = lump(LUMP.brushes);
    this.brushes = [];
    for (let p = l.off; p < l.off + l.len; p += 12) {
      this.brushes.push({ firstSide: dv.getInt32(p, true), numSides: dv.getInt32(p + 4, true), contents: dv.getInt32(p + 8, true) });
    }
    l = lump(LUMP.brushsides);
    this.brushsides = [];
    for (let p = l.off; p < l.off + l.len; p += 4) {
      this.brushsides.push({ plane: dv.getUint16(p, true), texinfo: dv.getInt16(p + 2, true) });
    }

    l = lump(LUMP.areas);
    this.areas = [];
    for (let p = l.off; p < l.off + l.len; p += 8) this.areas.push({ numPortals: dv.getInt32(p, true), firstPortal: dv.getInt32(p + 4, true) });
    l = lump(LUMP.areaportals);
    this.areaportals = [];
    for (let p = l.off; p < l.off + l.len; p += 8) this.areaportals.push({ portal: dv.getInt32(p, true), otherArea: dv.getInt32(p + 4, true) });

    // the PVS of every cluster as a hex string: cluster j visible ⇔ bit j.
    // Low nibble first, so the character for cluster j is at index j >> 2.
    this.numClusters = visLen ? dv.getInt32(visOff, true) : 0;
    this.pvsHex = new Array(Math.max(0, this.numClusters));
    if (visLen) {
      const rowBytes = (this.numClusters + 7) >> 3;
      const hex = '0123456789abcdef';
      for (let c = 0; c < this.numClusters; c++) {
        let p = visOff + dv.getInt32(visOff + 4 + c * 8, true);
        let s = '';
        let out = 0;
        while (out < rowBytes) {
          if (bytes[p]) {
            const b = bytes[p++];
            s += hex[b & 15] + hex[b >> 4];
            out++;
          } else {
            let n = bytes[p + 1];
            p += 2;
            while (n-- > 0 && out < rowBytes) { s += '00'; out++; }
          }
        }
        this.pvsHex[c] = s;
      }
    }

    this.computeFaceExtents();
  }

  /** The face's ordered vertex indices (surfedges resolved). */
  faceVertexIndices(f) {
    const out = [];
    for (let i = 0; i < f.numEdges; i++) {
      const se = this.surfedges[f.firstEdge + i];
      out.push(se >= 0 ? this.edges[se * 2] : this.edges[-se * 2 + 1]);
    }
    return out;
  }

  vertex(i) {
    return [this.vertices[i * 3], this.vertices[i * 3 + 1], this.vertices[i * 3 + 2]];
  }

  /** CalcSurfaceExtents: texture-space bounds, lightmap size, the kind of surface. */
  computeFaceExtents() {
    for (const f of this.faces) {
      const ti = this.texinfo[f.texinfo];
      let smin = Infinity, smax = -Infinity, tmin = Infinity, tmax = -Infinity;
      const idx = this.faceVertexIndices(f);
      f.verts = idx;
      for (const vi of idx) {
        const v = this.vertex(vi);
        const s = v[0] * ti.s[0] + v[1] * ti.s[1] + v[2] * ti.s[2] + ti.soff;
        const t = v[0] * ti.t[0] + v[1] * ti.t[1] + v[2] * ti.t[2] + ti.toff;
        if (s < smin) smin = s; if (s > smax) smax = s;
        if (t < tmin) tmin = t; if (t > tmax) tmax = t;
      }
      const bs = Math.floor(smin / 16), bt = Math.floor(tmin / 16);
      const es = Math.ceil(smax / 16), et = Math.ceil(tmax / 16);
      f.texturemins = [bs * 16, bt * 16];
      f.extents = [(es - bs) * 16, (et - bt) * 16];
      f.lightW = (f.extents[0] >> 4) + 1;
      f.lightH = (f.extents[1] >> 4) + 1;
      f.flags = ti.flags;
      f.sky = (ti.flags & SURF.SKY) !== 0;
      f.liquid = (ti.flags & SURF.WARP) !== 0;
      f.nodraw = (ti.flags & SURF.NODRAW) !== 0;
    }
  }

  /** The leaf containing a point (Mod_PointInLeaf). */
  pointLeaf(x, y, z) {
    let n = this.models[0].headnode;
    while (n >= 0) {
      const node = this.nodes[n];
      const pl = this.planes[node.plane];
      n = node.children[x * pl.nx + y * pl.ny + z * pl.nz - pl.dist >= 0 ? 0 : 1];
    }
    return -1 - n;
  }
}

/** The entity lump: [{ classname, origin: 'x y z', ... }, ...] with lower-cased keys. */
export function parseEntities(text) {
  const ents = [];
  const re = /\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const kv = {};
    const pr = /"([^"]*)"\s*"([^"]*)"/g;
    let p;
    while ((p = pr.exec(m[1]))) kv[p[1].toLowerCase()] = p[2];
    ents.push(kv);
  }
  return ents;
}

export const parseVec = (s) => {
  if (!s) return [0, 0, 0];
  const a = s.trim().split(/\s+/).map(Number);
  return [a[0] || 0, a[1] || 0, a[2] || 0];
};
