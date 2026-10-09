// loader.js – copy a PAK's models and a BSP into Firebird.
//
// Shared by the browser (src/main.js) and the Node tests (scripts/*.mjs), so
// CI exercises exactly the SQL the page runs.
//
// Bulk loading: the WASM build binds parameters as text, so each table has a
// generated LOAD_<table> procedure that takes a 30 KB chunk of rows and parses
// it in PSQL. The rows are fixed-width (each column padded to its widest value,
// the widths sent alongside), so a row is one INSERT of SUBSTRINGs at known
// offsets: no per-field scanning or assignments, which cost a statement each.
// CAST takes a blank-padded number as it is; only a nullable column (`?` in its
// spec) pays for the TRIM and NULLIF that turn an empty cell into NULL, which
// cost twice the CAST.

import { Bsp, parseVec, SURF } from './bsp.js';
import { Md2, Sp2 } from './md2.js';
import { loadPcx } from './pak.js';
import { MONSTERS, LIGHTSTYLES, EXTRA_ANIMS } from './gamedata.js';

const CHUNK = 30000;

// column specs: name:type where type ∈ i (integer) d (double) s (string), `?` when it may be NULL
const TABLES = {
  nodes: 'id:i nx:d ny:d nz:d dist:d ptype:i c0:i c1:i cc0:i? cc1:i?',
  leaves: 'id:i contents:i cluster:i area:i minx:d miny:d minz:d maxx:d maxy:d maxz:d first_lf:i num_lf:i first_lb:i num_lb:i pvs:s?',
  leaffaces: 'id:i face:i',
  areas: 'id:i num_ap:i first_ap:i',
  areaportals: 'id:i portal:i other_area:i',
  leafbrushes: 'id:i brush:i',
  brushes: 'id:i contents:i first_side:i num_sides:i minx:d miny:d minz:d maxx:d maxy:d maxz:d',
  brushsides: 'id:i nx:d ny:d nz:d dist:d flags:i',
  faces: 'id:i model_id:i nx:d ny:d nz:d dist:d nverts:i tex:i sx:d sy:d sz:d soff:d tx:d ty:d tz:d toff:d flags:i style0:i cx:d cy:d cz:d radius:d',
  face_verts: 'face:i seq:i x:d y:d z:d',
  textures: 'id:i name:s w:i h:i flags:i',
  models: 'id:i name:s kind:s minx:d? miny:d? minz:d? maxx:d? maxy:d? maxz:d? headnode:i? first_face:i? num_faces:i? nframes:i? flags:i? radius:d?',
  anims: 'model_id:i anim:s first_frame:i frame_count:i',
  map_ents: 'id:i classname:s targetname:s? target:s? killtarget:s? pathtarget:s? deathtarget:s? combattarget:s? team:s? model:s? ox:d? oy:d? oz:d? angle:d? apitch:d? ayaw:d? aroll:d? spawnflags:i? message:s? wait_:d? delay:d? random_:d? speed:d? accel:d? decel:d? lip:d? height:d? health:i? light:i? style:i? sounds:i? dmg:i? count_:i? map:s? noise:s? item:s? mass:i? volume:d? attenuation:d? distance:d? gravity:d? sky:s? skyrotate:d? minpitch:d? maxpitch:d? minyaw:d? maxyaw:d?',
};

const SQL_TYPE = { i: 'INTEGER', d: 'DOUBLE PRECISION', s: 'VARCHAR(2048) CHARACTER SET ASCII' };

/** The LOAD_<table> procedures, generated from the column specs: (s, the rows; w, the columns' widths, ',' separated). */
export function loaderSql() {
  let out = 'SET TERM ^ ;\n';
  for (const [table, spec] of Object.entries(TABLES)) {
    const cols = spec.split(' ').map((c) => c.split(':'));
    out += `CREATE OR ALTER PROCEDURE load_${table} (s VARCHAR(32000) CHARACTER SET ASCII, w VARCHAR(1000) CHARACTER SET ASCII) AS\n`;
    out += 'DECLARE p INTEGER = 1; DECLARE q INTEGER = 1; DECLARE c INTEGER; DECLARE len INTEGER; DECLARE rl INTEGER;\n';
    cols.forEach((_, i) => { out += `DECLARE o${i} INTEGER; DECLARE w${i} INTEGER;\n`; });
    out += 'BEGIN\n  len = CHAR_LENGTH(s);\n';
    // the widths, once per chunk, and each column's offset in the row
    cols.forEach((_, i) => {
      out += i === cols.length - 1
        ? `  w${i} = CAST(SUBSTRING(w FROM q) AS INTEGER);\n`
        : `  c = POSITION(',', w, q); w${i} = CAST(SUBSTRING(w FROM q FOR c - q) AS INTEGER); q = c + 1;\n`;
      out += `  o${i} = ${i === 0 ? '0' : `o${i - 1} + w${i - 1}`};\n`;
    });
    out += `  rl = o${cols.length - 1} + w${cols.length - 1};\n`;
    const val = ([, type], i) => {
      const f = `SUBSTRING(:s FROM :p + :o${i} FOR :w${i})`, t = SQL_TYPE[type[0]], nullable = type[1] === '?';
      if (type[0] === 's') return nullable ? `NULLIF(TRIM(TRAILING FROM ${f}), '')` : `TRIM(TRAILING FROM ${f})`;
      return nullable ? `CAST(NULLIF(TRIM(${f}), '') AS ${t})` : `CAST(${f} AS ${t})`;
    };
    out += `  WHILE (p <= len) DO BEGIN\n    INSERT INTO ${table} (${cols.map((c) => c[0]).join(', ')}) VALUES (${cols.map(val).join(', ')});\n`;
    out += '    p = p + rl;\n  END\nEND^\n';
  }
  return out + 'SET TERM ; ^\n';
}

const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : String(v));
const str = (v) => (v === null || v === undefined ? '' : String(v).replace(/[|\n\r]/g, ' ').replace(/[^\x20-\x7e]/g, '?'));

/** rows: arrays of values in column order. */
export async function bulkLoad(db, table, rows) {
  if (!rows.length) return;
  const cells = rows.map((r) => r.map((v) => (typeof v === 'string' ? str(v) : num(v))));
  // each column as wide as its widest value (at least 1), every row the same length
  const widths = cells[0].map((_, i) => Math.max(1, ...cells.map((r) => r[i].length)));
  const lines = cells.map((r) => r.map((v, i) => v.padEnd(widths[i])).join(''));
  const per = Math.max(1, Math.floor(CHUNK / lines[0].length));
  // an empty cell in a column not marked nullable would be a blank the CAST cannot read
  const types = TABLES[table].split(' ').map((c) => c.split(':')[1]);
  types.forEach((t, c) => { if (!t.endsWith('?') && cells.some((r) => r[c] === '')) throw new Error(`bulkLoad: ${table} column ${c} has a NULL; mark it '?'`); });
  const w = widths.join(',');
  for (let i = 0; i < lines.length; i += per) await db.query(`EXECUTE PROCEDURE load_${table}(?, ?)`, [lines.slice(i, i + per).join(''), w]);
}

export const SQL_FILES = ['schema', 'physics', 'game', 'weapons', 'monsters', 'render'];

export async function createSchema(db, sql) {
  await db.exec(sql.schema);
  await db.exec(loaderSql());
  for (const f of SQL_FILES.slice(1)) await db.exec(sql[f]);
}

/**
 * Resources: everything that does not change between maps – alias models,
 * sprites, monster definitions, light styles. Returns the model registry the
 * JS renderer needs alongside (with skins and sprite frames decoded).
 */
export async function loadResources(db, pak, { width = 320, height = 200, fov = 90 } = {}) {
  await db.exec('DELETE FROM anims; DELETE FROM models; DELETE FROM monster_types; DELETE FROM lightstyles; DELETE FROM game; DELETE FROM player; DELETE FROM viewcfg; ' +
    'DELETE FROM face_verts; DELETE FROM faces; DELETE FROM textures; DELETE FROM nodes; DELETE FROM leaves; DELETE FROM leaffaces; DELETE FROM leafbrushes; DELETE FROM areas; DELETE FROM areaportals; DELETE FROM portal_state; DELETE FROM area_flood; ' +
    'DELETE FROM brushes; DELETE FROM brushsides; DELETE FROM ents; DELETE FROM map_ents');

  const res = { models: new Map(), byName: new Map(), nextModel: 1, pak, pics: new Map() };
  const modelRows = [];
  const animRows = [];

  for (const name of pak.list('', '.md2')) {
    let m;
    try { m = new Md2(pak.buffer(name), name); } catch (e) { console.warn(e.message); continue; }
    // skins: the names in the file, or any .pcx in the model's directory
    const dir = name.slice(0, name.lastIndexOf('/') + 1);
    const skinNames = m.skinNames.filter((s) => pak.has(s));
    if (!skinNames.length) skinNames.push(...pak.list(dir, '.pcx'));
    for (const s of skinNames) {
      try { const p = loadPcx(pak.get(s)); m.skins.push({ w: p.w, h: p.h, data: p.data }); } catch { /* skip */ }
    }
    if (!m.skins.length) m.skins.push({ w: m.skinW, h: m.skinH, data: new Uint8Array(m.skinW * m.skinH).fill(15) });
    const id = res.nextModel++;
    res.models.set(id, { id, name, kind: 'M', mdl: m });
    res.byName.set(name, id);
    modelRows.push([id, name, 'M', null, null, null, null, null, null, null, null, null, m.numFrames, m.flags, m.radius]);
    const anims = m.animations();
    for (const a of anims) animRows.push([id, a.name, a.first, a.count]);
    for (const [mname, aname, base, off, count] of EXTRA_ANIMS) {
      const b = mname === name ? anims.find((a) => a.name === base) : null;
      if (b) animRows.push([id, aname, b.first + off, count]);
    }
  }
  for (const name of pak.list('', '.sp2')) {
    let s;
    try { s = new Sp2(pak.buffer(name), name); } catch (e) { console.warn(e.message); continue; }
    for (const fr of s.frames) {
      if (pak.has(fr.pic)) { const p = loadPcx(pak.get(fr.pic)); fr.data = p.data; fr.w = p.w; fr.h = p.h; }
      else fr.data = new Uint8Array(fr.w * fr.h).fill(255);
    }
    const id = res.nextModel++;
    res.models.set(id, { id, name, kind: 'S', spr: s });
    res.byName.set(name, id);
    modelRows.push([id, name, 'S', null, null, null, null, null, null, null, null, null, s.frames.length, 0, s.radius]);
  }
  await bulkLoad(db, 'models', modelRows);
  await bulkLoad(db, 'anims', animRows);

  const styleRows = LIGHTSTYLES.map((p, i) => `INSERT INTO lightstyles (style, pattern) VALUES (${i}, '${p}');`).join('\n');
  await db.exec(`SET TERM ^ ;\nEXECUTE BLOCK AS BEGIN\n${styleRows}\nEND^\nSET TERM ; ^`);
  await loadMonsterTypes(db, pak);
  await db.exec('INSERT INTO game (id) VALUES (1); INSERT INTO player (id) VALUES (1)');
  await setView(db, width, height, fov);
  return res;
}

async function loadMonsterTypes(db, pak) {
  const lit = (v) => (v === null || v === undefined ? 'DEFAULT' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const cols = ['name', 'model', 'skin', 'health', 'gib_health', 'mass', 'minx', 'miny', 'minz', 'maxx', 'maxy', 'maxz', 'flags', 'run_speed', 'walk_speed', 'yaw_speed',
    'stand_anim', 'walk_anim', 'run_anim', 'pain_anims', 'death_anims', 'melee_anim', 'melee_frame', 'melee_range', 'melee_dmg',
    'missile_anim', 'missile_frames', 'missile_kind', 'attack_chance', 'pain_chance', 'sight_snd', 'idle_snd', 'search_snd', 'pain_snd',
    'death_snd', 'attack_snd', 'melee_snd', 'drop_item'];
  const body = MONSTERS.map((m) => `INSERT INTO monster_types (${cols.join(', ')}) VALUES (${cols.map((c) => lit(m[c] ?? null)).join(', ')});`).join('\n');
  await db.exec(`SET TERM ^ ;\nEXECUTE BLOCK AS BEGIN\n${body}\nEND^\nSET TERM ; ^`);
}

export async function setView(db, width, height, fov = 90) {
  await db.exec(`UPDATE OR INSERT INTO viewcfg (id, w, h, fov, near_z) VALUES (1, ${width}, ${height}, ${fov}, 4) MATCHING (id)`);
}

/**
 * Rows for one BSP's geometry. Faces, nodes, leaves, brushes and their index
 * tables all use the BSP's own indices (one map is loaded at a time).
 */
function geometryRows(bsp, res) {
  const out = { faces: [], faceVerts: [], textures: [], models: [], nodes: [], leaves: [], leaffaces: [], leafbrushes: [], brushes: [], brushsides: [], modelIds: [], modelInfo: new Map() };

  bsp.textureNames.forEach((t, i) => out.textures.push([i, t, 0, 0, 0]));
  const modelOfFace = new Int32Array(bsp.faces.length).fill(-1);
  bsp.models.forEach((m, mi) => {
    for (let f = m.firstFace; f < m.firstFace + m.numFaces; f++) modelOfFace[f] = mi;
  });
  const modelIds = bsp.models.map(() => res.nextModel++);
  out.modelIds = modelIds;
  bsp.faces.forEach((f, fi) => {
    const pl = bsp.planes[f.plane];
    const sgn = f.side ? -1 : 1;
    const ti = bsp.texinfo[f.texinfo];
    let cx = 0, cy = 0, cz = 0;
    for (const vi of f.verts) { cx += bsp.vertices[vi * 3]; cy += bsp.vertices[vi * 3 + 1]; cz += bsp.vertices[vi * 3 + 2]; }
    cx /= f.verts.length; cy /= f.verts.length; cz /= f.verts.length;
    let rad = 0;
    for (const vi of f.verts) rad = Math.max(rad, Math.hypot(bsp.vertices[vi * 3] - cx, bsp.vertices[vi * 3 + 1] - cy, bsp.vertices[vi * 3 + 2] - cz));
    out.faces.push([fi, modelIds[modelOfFace[fi]] ?? modelIds[0], sgn * pl.nx, sgn * pl.ny, sgn * pl.nz, sgn * pl.dist, f.verts.length,
      ti.tex, ti.s[0], ti.s[1], ti.s[2], ti.soff, ti.t[0], ti.t[1], ti.t[2], ti.toff, ti.flags, f.styles[0], cx, cy, cz, rad]);
    f.verts.forEach((vi, k) => {
      out.faceVerts.push([fi, k, bsp.vertices[vi * 3], bsp.vertices[vi * 3 + 1], bsp.vertices[vi * 3 + 2]]);
    });
  });
  bsp.models.forEach((m, mi) => {
    const id = modelIds[mi];
    const name = mi === 0 ? bsp.name : `*${mi}`;
    out.models.push([id, name, 'B', m.mins[0], m.mins[1], m.mins[2], m.maxs[0], m.maxs[1], m.maxs[2], m.headnode, m.firstFace, m.numFaces, 1, 0, 0]);
    out.modelInfo.set(id, { id, name, kind: 'B', bsp, sub: mi, faceBase: 0 });
  });
  bsp.nodes.forEach((n, ni) => {
    const pl = bsp.planes[n.plane];
    const cc = (c) => (c < 0 ? bsp.leaves[-1 - c].contents : null);
    out.nodes.push([ni, pl.nx, pl.ny, pl.nz, pl.dist, pl.type < 3 ? pl.type : 3, n.children[0], n.children[1], cc(n.children[0]), cc(n.children[1])]);
  });
  bsp.leaves.forEach((l, li) => {
    out.leaves.push([li, l.contents, l.cluster, l.area, ...l.mins, ...l.maxs, l.firstLeafFace, l.numLeafFaces, l.firstLeafBrush, l.numLeafBrushes,
      l.cluster >= 0 ? bsp.pvsHex[l.cluster] ?? '' : '']);
  });
  for (let i = 0; i < bsp.leaffaces.length; i++) out.leaffaces.push([i, bsp.leaffaces[i]]);
  // areas and the portals between them (a func_areaportal's style is the portal number)
  out.areas = bsp.areas.map((a, i) => [i, a.numPortals, a.firstPortal]);
  out.areaportals = bsp.areaportals.map((p, i) => [i, p.portal, p.otherArea]);
  for (let i = 0; i < bsp.leafbrushes.length; i++) out.leafbrushes.push([i, bsp.leafbrushes[i]]);
  // a brush's bounds: the union of the leaves that list it
  const bb = new Float64Array(bsp.brushes.length * 6);
  for (let i = 0; i < bsp.brushes.length; i++) { bb[i * 6] = bb[i * 6 + 1] = bb[i * 6 + 2] = Infinity; bb[i * 6 + 3] = bb[i * 6 + 4] = bb[i * 6 + 5] = -Infinity; }
  for (const lf of bsp.leaves) {
    for (let k = 0; k < lf.numLeafBrushes; k++) {
      const b = bsp.leafbrushes[lf.firstLeafBrush + k] * 6;
      for (let a = 0; a < 3; a++) { if (lf.mins[a] < bb[b + a]) bb[b + a] = lf.mins[a]; if (lf.maxs[a] > bb[b + 3 + a]) bb[b + 3 + a] = lf.maxs[a]; }
    }
  }
  const brushBounds = new Array(bsp.brushes.length);
  bsp.brushes.forEach((b, bi) => {
    const o = bi * 6;
    const fin = (v, d) => (Number.isFinite(v) ? v : d);
    const bounds = [fin(bb[o], -99999), fin(bb[o + 1], -99999), fin(bb[o + 2], -99999), fin(bb[o + 3], 99999), fin(bb[o + 4], 99999), fin(bb[o + 5], 99999)];
    // an axial side bounds the brush exactly on its axis
    for (let k = 0; k < b.numSides; k++) {
      const pl = bsp.planes[bsp.brushsides[b.firstSide + k].plane];
      const n = [pl.nx, pl.ny, pl.nz];
      for (let ax = 0; ax < 3; ax++) {
        if (n[ax] > 0.9999) bounds[3 + ax] = Math.min(bounds[3 + ax], pl.dist);
        else if (n[ax] < -0.9999) bounds[ax] = Math.max(bounds[ax], -pl.dist);
      }
    }
    out.brushes.push([bi, b.contents, b.firstSide, b.numSides, ...bounds]);
    brushBounds[bi] = bounds;
  });
  bsp.brushsides.forEach((s, si) => {
    const pl = bsp.planes[s.plane];
    const flags = s.texinfo >= 0 && bsp.texinfo[s.texinfo] ? bsp.texinfo[s.texinfo].flags : 0;
    out.brushsides.push([si, pl.nx, pl.ny, pl.nz, pl.dist, flags]);
  });
  return out;
}

const ENT_NUM = ['angle', 'spawnflags', 'wait', 'delay', 'random', 'speed', 'accel', 'decel', 'lip', 'height', 'health', 'light', 'style', 'sounds', 'dmg', 'count',
  'mass', 'volume', 'attenuation', 'distance', 'gravity', 'skyrotate', 'minpitch', 'maxpitch', 'minyaw', 'maxyaw'];

/** SV_SpawnServer: replace the current map with `name` from the PAK. */
export async function loadMap(db, pak, res, name, { skill = 1, newGame = true, spawnpoint = null } = {}) {
  const bsp = new Bsp(pak.buffer(`maps/${name}.bsp`), `maps/${name}.bsp`);
  await db.exec(`DELETE FROM sound_events; DELETE FROM fx_events; DELETE FROM ents; DELETE FROM map_ents; DELETE FROM vis_faces; UPDATE viewcfg SET vis_cluster = NULL;
    DELETE FROM face_verts; DELETE FROM faces; DELETE FROM textures; DELETE FROM nodes; DELETE FROM leaves; DELETE FROM leaffaces; DELETE FROM leafbrushes; DELETE FROM areas; DELETE FROM areaportals; DELETE FROM portal_state; DELETE FROM area_flood;
    DELETE FROM brushes; DELETE FROM brushsides; DELETE FROM models WHERE kind = 'B'`);
  for (const [id, m] of [...res.models]) if (m.kind === 'B') res.models.delete(id);
  const geo = geometryRows(bsp, res);
  for (const [mid, info] of geo.modelInfo) res.models.set(mid, info);
  res.world = { bsp, modelIds: geo.modelIds, faceBase: 0 };

  await bulkLoad(db, 'models', geo.models);
  await bulkLoad(db, 'textures', geo.textures);
  await bulkLoad(db, 'faces', geo.faces);
  await bulkLoad(db, 'face_verts', geo.faceVerts);
  await bulkLoad(db, 'nodes', geo.nodes);
  await bulkLoad(db, 'leaves', geo.leaves);
  await bulkLoad(db, 'areas', geo.areas);
  await bulkLoad(db, 'areaportals', geo.areaportals);
  await bulkLoad(db, 'leaffaces', geo.leaffaces);
  await bulkLoad(db, 'leafbrushes', geo.leafbrushes);
  await bulkLoad(db, 'brushes', geo.brushes);
  await bulkLoad(db, 'brushsides', geo.brushsides);

  const entRows = bsp.entities.map((e, i) => {
    const o = parseVec(e.origin);
    const angles = e.angles ? parseVec(e.angles) : [null, null, null];
    const n = (k) => (e[k] === undefined || e[k] === '' || Number.isNaN(Number(e[k])) ? null : Number(e[k]));
    return [i, e.classname ?? 'unknown', e.targetname ?? null, e.target ?? null, e.killtarget ?? null, e.pathtarget ?? null, e.deathtarget ?? null,
      e.combattarget ?? null, e.team ?? null, e.model ?? null, o[0], o[1], o[2], n('angle'), angles[0], angles[1], angles[2], n('spawnflags') ?? 0,
      e.message ?? null, n('wait'), n('delay'), n('random'), n('speed'), n('accel'), n('decel'), n('lip'), n('height'), n('health'), n('light'),
      n('style'), n('sounds'), n('dmg'), n('count'), e.map ?? null, e.noise ?? null, e.item ?? null, n('mass'), n('volume'), n('attenuation'),
      n('distance'), n('gravity'), e.sky ?? null, n('skyrotate'), n('minpitch'), n('maxpitch'), n('minyaw'), n('maxyaw')];
  });
  await bulkLoad(db, 'map_ents', entRows);

  await db.exec(`EXECUTE PROCEDURE init_map('${name}', ${geo.modelIds[0]}, ${skill}, ${newGame ? 1 : 0}, ${spawnpoint ? "'" + String(spawnpoint).replace(/'/g, '') + "'" : 'NULL'})`);
  return bsp;
}

export { ENT_NUM, SURF };
