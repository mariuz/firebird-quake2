// inspect.mjs – what is in the pak? Maps, their entities and textures, the
// models and their frame runs, the sounds. Handy while porting game code.
//
//   node scripts/inspect.mjs                 overview
//   node scripts/inspect.mjs map demo1       one map's entity classes and texinfo
//   node scripts/inspect.mjs model models/monsters/soldier/tris.md2
//   node scripts/inspect.mjs ents demo1      the full entity lump
//   node scripts/inspect.mjs grep soldier    file names matching

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pak, Wal, loadPcx } from '../src/pak.js';
import { Bsp } from '../src/bsp.js';
import { Md2, Sp2 } from '../src/md2.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const [, , cmd, arg] = process.argv;

if (!cmd) {
  const byDir = new Map();
  for (const n of pak.files.keys()) { const d = n.split('/')[0]; byDir.set(d, (byDir.get(d) ?? 0) + 1); }
  console.log('files per top directory:', Object.fromEntries(byDir));
  console.log('maps:', pak.mapNames());
  console.log('models:', pak.list('models/', '.md2').length, 'md2,', pak.list('', '.sp2').length, 'sp2');
  console.log('textures:', pak.list('textures/', '.wal').length, 'wal');
  console.log('sounds:', pak.list('sound/', '.wav').length, 'wav');
  console.log('pics:', pak.list('pics/', '.pcx').join(' '));
  console.log('env:', pak.list('env/').join(' '));
  for (const m of pak.mapNames()) {
    const b = new Bsp(pak.buffer(`maps/${m}.bsp`), m);
    const ws = b.entities.find((e) => e.classname === 'worldspawn');
    console.log(`${m}: ${b.faces.length} faces, ${b.leaves.length} leaves, ${b.numClusters} clusters, ${b.brushes.length} brushes, ${b.brushsides.length} sides, ${b.nodes.length} nodes, ${b.models.length} models, ${b.entities.length} ents, ${b.textureNames.length} textures, ${b.areas.length} areas; sky "${ws?.sky}" message "${ws?.message}" sounds ${ws?.sounds} nextmap ${b.entities.find((e) => e.classname === 'target_changelevel')?.map}`);
  }
} else if (cmd === 'map') {
  const b = new Bsp(pak.buffer(`maps/${arg}.bsp`), arg);
  const cls = new Map();
  for (const e of b.entities) cls.set(e.classname, (cls.get(e.classname) ?? 0) + 1);
  console.log('classes:', [...cls].sort((a, b2) => b2[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' '));
  const keys = new Set();
  for (const e of b.entities) for (const k of Object.keys(e)) keys.add(k);
  console.log('keys:', [...keys].sort().join(' '));
  console.log('textures:', b.textureNames.join(' '));
  const missing = b.textureNames.filter((t) => !pak.has(`textures/${t}.wal`));
  console.log('missing textures:', missing.join(' ') || 'none');
  const flags = new Map();
  for (const ti of b.texinfo) flags.set(ti.flags, (flags.get(ti.flags) ?? 0) + 1);
  console.log('texinfo flags:', Object.fromEntries(flags));
  const contents = new Map();
  for (const br of b.brushes) contents.set(br.contents.toString(16), (contents.get(br.contents.toString(16)) ?? 0) + 1);
  console.log('brush contents:', Object.fromEntries(contents));
  const lc = new Map();
  for (const lf of b.leaves) lc.set(lf.contents.toString(16), (lc.get(lf.contents.toString(16)) ?? 0) + 1);
  console.log('leaf contents:', Object.fromEntries(lc));
  console.log('pvs row chars:', b.pvsHex[1]?.length, 'models:', b.models.map((m, i) => `*${i}:${m.numFaces}f`).join(' '));
  const start = b.entities.find((e) => e.classname === 'info_player_start');
  console.log('player start:', start);
} else if (cmd === 'ents') {
  const b = new Bsp(pak.buffer(`maps/${arg}.bsp`), arg);
  for (const e of b.entities) console.log(JSON.stringify(e));
} else if (cmd === 'model') {
  if (arg.endsWith('.sp2')) {
    const s = new Sp2(pak.buffer(arg), arg);
    console.log(s.frames);
  } else {
    const m = new Md2(pak.buffer(arg), arg);
    console.log(`${arg}: ${m.numVerts} verts, ${m.numTris} tris, ${m.numFrames} frames, skin ${m.skinW}×${m.skinH}, skins ${m.skinNames.join(', ')}`);
    console.log('frame 0 scale/translate', m.frames[0].scale, m.frames[0].translate, 'radius', m.radius);
    console.log('anims:', m.animations().map((a) => `${a.name}[${a.first}+${a.count}]`).join(' '));
    const dir = arg.slice(0, arg.lastIndexOf('/') + 1);
    console.log('pcx in dir:', pak.list(dir, '.pcx').join(' '));
  }
} else if (cmd === 'models') {
  for (const n of pak.list('models/', '.md2')) {
    const m = new Md2(pak.buffer(n), n);
    console.log(`${n}: ${m.numFrames}f ${m.numTris}t skins[${m.skinNames.join(',')}] anims ${m.animations().map((a) => `${a.name}:${a.count}`).join(' ')}`);
  }
} else if (cmd === 'grep') {
  for (const n of pak.files.keys()) if (n.includes(arg)) console.log(n, pak.files.get(n).size);
} else if (cmd === 'wal') {
  const w = new Wal(pak.get(arg), arg);
  console.log(w.name, w.w, w.h, 'anim', w.animname, 'flags', w.flags.toString(16), 'contents', w.contents.toString(16), 'value', w.value);
} else if (cmd === 'pcx') {
  const p = loadPcx(pak.get(arg));
  console.log(arg, p.w, p.h, 'palette', !!p.palette);
}
