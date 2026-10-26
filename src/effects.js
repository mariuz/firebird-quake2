// effects.js – the client's temporary entities (cl_tent.c), kept between frames: the explosions' models and
// sprites, the beams, the parasite's tongue and the muzzle flashes, made from FRAME_ALL's effect rows and drawn
// with the frame; and the frame's dynamic lights (CL_AddExplosions, CL_AddBeams, the EF_ flags' lights).
//
// No DOM: the renderer and the models are handed in, and the chances come from `random` (Math.random unless
// a test gives its own), so `scripts/effects-test.mjs` drives it headless with a renderer that records.

import { lightPoint, dlightAt } from './renderer.js';

export class Effects {
  /**
   * @param {{ model(name: string): object|undefined, sprite(name: string): object|undefined }} lookup
   *   the pak's MD2 and SP2 models by name (the resources the map loaded)
   * @param {() => number} [random]  the client's chances: an explosion's yaw and frames, a tongue segment's roll
   */
  constructor(lookup, random = Math.random) {
    this.lookup = lookup;
    this.random = random;
    this.clear();
  }

  /** A new map or a loaded game: nothing carries over. */
  clear() {
    this.beams = [];            // [{ a, b, color, until }]
    this.tongues = new Map();   // TE_PARASITE_ATTACK by parasite: { a, b, until } (CL_ParseBeam: one per entity, 0.2 s)
    this.explosions = [];       // CL_AddExplosions' list: [{ x, y, z, t0, type, mdl | spr, base, frames, light, c, pitch, yaw }]
    this.flashes = [];          // muzzle flashes' lights: [{ x, y, z, r, die }] (each lasts the frame it is seen in)
  }

  /**
   * The frame's effect rows (decodeFrame's fx: [id, kind, x, y, z, x2, y2, z2, n]) at `time`: particles go
   * to the renderer at once, the rest is kept until it has played out (CL_ParseTEnt).
   */
  add(rows, time, renderer) {
    const model = (name) => this.lookup.model(name);
    const random = this.random;
    for (const [, kind, x, y, z, x2, y2, z2, n] of rows) {
      switch (kind) {
        // TE_GUNSHOT (40 particles) and TE_SHOTGUN (20): CL_ParticleEffect, then CL_SmokeAndFlash: the smoke model,
        // translucent over 4 frames, and the flash model, fullbright for 2, both at the hit with no light of their own
        case 1: case 11:
          renderer.spawnParticles('gunshot', x, y, z, kind === 1 ? 40 : 20, [x2, y2, z2], 0);
          this.explosions.push({ x, y, z, t0: time, type: 'smoke', mdl: model('models/objects/smoke/tris.md2'), base: 0, frames: 4, light: 0, pitch: 0, yaw: 0 });
          this.explosions.push({ x, y, z, t0: time, type: 'flash', mdl: model('models/objects/flash/tris.md2'), base: 0, frames: 2, light: 0, pitch: 0, yaw: 0 });
          break;
        // TE_EXPLOSION1, TE_ROCKET_EXPLOSION: the r_explode model from frame 0 or 15, 15 frames; TE_GRENADE_EXPLOSION from 30, 19
        case 2: renderer.spawnParticles('explosion', x, y, z, 0); this.explosions.push({ x, y, z, t0: time, type: 'poly', mdl: model('models/objects/r_explode/tris.md2'), base: random() < 0.5 ? 15 : 0, frames: 15, light: 350, pitch: 0, yaw: Math.floor(random() * 360) }); break;
        case 9: renderer.spawnParticles('explosion', x, y, z, 0); this.explosions.push({ x, y, z, t0: time, type: 'poly', mdl: model('models/objects/r_explode/tris.md2'), base: 30, frames: 19, light: 350, pitch: 0, yaw: Math.floor(random() * 360) }); break;
        case 3: renderer.spawnParticles('blood', x, y, z, Math.min(n * 2, 60), [0, 0, 0], 0xe8); break;
        case 4: renderer.spawnParticles('rail', x, y, z, 0, [x2, y2, z2]); break;
        case 5: renderer.spawnParticles('teleport', x, y, z, 0); break;
        // TE_BLASTER: sparks, and the small explode model turned to the direction, fading over 4 frames
        case 6: renderer.spawnParticles('gunshot', x, y, z, 40, [x2, y2, z2], 0xe0);
          this.explosions.push({ x, y, z, t0: time, type: 'misc', mdl: model('models/objects/explode/tris.md2'), base: 0, frames: 4, light: 150,
            pitch: (Math.acos(Math.max(-1, Math.min(1, z2))) / Math.PI) * 180, yaw: x2 ? (Math.atan2(y2, x2) / Math.PI) * 180 : y2 > 0 ? 90 : y2 < 0 ? 270 : 0 }); break;
        case 15: this.flashes.push({ x, y, z, r: n, die: time }); break;   // a muzzle flash (MZ_*, MZ2_*)
        // TE_SPLASH: count and colour (cl_tent.c's splash_color: unknown, sparks, blue water, brown water, slime, lava, blood)
        case 7: renderer.spawnParticles('gunshot', x, y, z, Math.min(n >> 4, 64), [x2 || 0, y2 || 0, z2 || 1], [0x00, 0xe0, 0xb0, 0x50, 0xd0, 0xe0, 0xe8][n & 7] ?? 0); break;
        case 14: renderer.spawnParticles('bubbles', x, y, z, 0, [x2, y2, z2]); break;   // TE_BUBBLETRAIL
        // TE_BFG_EXPLOSION (each thing the blast reaches): the s_bfg2 sprite, 4 frames, translucent, no particles
        case 8: this.explosions.push({ x, y, z, t0: time, type: 'poly', spr: this.lookup.sprite('sprites/s_bfg2.sp2'), base: 0, frames: 4, light: 350, c: 1 / 3 }); break;
        // TE_BFG_BIGEXPLOSION (where the ball struck): CL_BFGExplosionParticles alone; the ball itself becomes the s_bfg3 sprite
        case 18: renderer.spawnParticles('bfg', x, y, z, 0); break;
        // TE_SPARKS, TE_BULLET_SPARKS, TE_SCREEN_SPARKS, TE_SHIELD_SPARKS, TE_LASER_SPARKS: CL_ParticleEffect with the count and
        // the colour n packs (count × 256 + colour; nothing packed: the sparks' 6 of 0xe0)
        case 10: renderer.spawnParticles('gunshot', x, y, z, (n >> 8) || 6, [x2, y2, z2], n >> 8 ? n & 255 : 0xe0); break;
        case 12: this.beams.push({ a: [x, y, z], b: [x2, y2, z2], color: 0xd0, until: time + 0.1 }); break;
        case 16: this.tongues.set(n, { a: [x, y, z], b: [x2, y2, z2], until: time + 0.2 }); break;   // TE_PARASITE_ATTACK
        case 13: this.beams.push({ a: [x, y, z], b: [x2, y2, z2], color: n & 2 ? 0xf2 : n & 4 ? 0xd0 : n & 8 ? 0xf3 : n & 16 ? 0xdc : 0xe0, until: time + 0.12 }); break;
        // EV_ITEM_RESPAWN: CL_ItemRespawnParticles' 64 in the respawn's greens (0xd4 + 0..3), rising slowly
        case 17: renderer.spawnParticles('gunshot', x, y, z, 64, [0, 0, 1], 0xd4); break;
        default: break;
      }
    }
  }

  /**
   * The frame's dynamic lights: muzzle flashes for the frame they come in, rockets, blaster and
   * hyperblaster bolts and the BFG ball at 200 (EF_ROCKET, EF_BLASTER, EF_HYPERBLASTER, EF_BFG), and the
   * explosions fading with their frames (CL_AddExplosions: ex_poly at (16 - frame) / 16 of 350 from frame 1,
   * the blaster's hit, ex_misc, at 1 - frac / 3 of 150; a gunshot's smoke and flash have none). Explosions that
   * have played out are dropped here (ex_misc and the smoke at their last frame, ex_flash after its first).
   * `ents` are decodeFrame's entity rows ([…, x at 4, y 5, z 6, …, effects at 10]).
   */
  lights(ents, time) {
    const lights = [];
    this.flashes = this.flashes.filter((f) => f.die >= time);
    lights.push(...this.flashes);
    for (const e of ents) {
      const effects = e[10];
      if (effects & (8 | 16 | 64 | 128)) lights.push({ x: e[4], y: e[5], z: e[6], r: 200, c: effects & 128 ? 1 / 3 : 2 / 3 });
    }
    this.explosions = this.explosions.filter((ex) => {
      const frac = 1 + (time - ex.t0) * 10, f = Math.floor(frac);
      // (the frame count starts at 1 here, where CL_AddExplosions had cl.time a server frame behind: ex_flash's
      // "f >= 1" is one tic on, f >= 2)
      if (ex.type === 'flash' ? f >= 2 : f >= ex.frames - 1) return false;
      ex.alpha = ex.type === 'misc' || ex.type === 'smoke' ? 1 - frac / (ex.frames - 1) : ex.type === 'flash' ? 1 : (16 - f) / 16;
      if (ex.alpha > 0 && ex.light > 0) lights.push({ x: ex.x, y: ex.y, z: ex.z, r: ex.light * ex.alpha, c: ex.c });
      return true;
    });
    return lights;
  }

  /**
   * Draw the beams, the tongues and the explosions into the frame, after the entities and before the
   * particles; `bsp` lights a tongue's segments where they hang. Call after lights(), which sets each
   * explosion's alpha.
   */
  draw(r, bsp, time) {
    this.beams = this.beams.filter((b) => b.until > time);
    for (const b of this.beams) r.drawBeam(b.a, b.b, b.color);
    // CL_AddBeams: the parasite's segment model every 30 units from the mouth toward the end, turned along the
    // tongue, each at a random roll, lit where it hangs
    const seg = this.lookup.model('models/monsters/parasite/segment/tris.md2');
    for (const [id, b] of this.tongues) {
      if (b.until <= time) { this.tongues.delete(id); continue; }
      if (!seg) continue;
      const dx = b.b[0] - b.a[0], dy = b.b[1] - b.a[1], dz = b.b[2] - b.a[2];
      let d = Math.hypot(dx, dy, dz);
      if (!d) continue;
      const yaw = dx || dy ? (Math.atan2(dy, dx) * 180) / Math.PI : 0;
      const pitch = dx || dy ? (Math.atan2(dz, Math.hypot(dx, dy)) * 180) / Math.PI : dz > 0 ? 90 : -90;
      const steps = Math.ceil(d / 30), len = steps > 1 ? (d - 30) / (steps - 1) : 0;
      const ux = dx / d, uy = dy / d, uz = dz / d;
      const o = b.a.slice();
      while (d > 0) {
        r.drawAlias(seg, 0, 0, o.slice(), [pitch, yaw, Math.floor(this.random() * 360)], lightPoint(bsp, o[0], o[1], o[2]),
          { time, alpha: false, dlight: dlightAt(r.dlights, o[0], o[1], o[2]), glow: false });
        o[0] += ux * len; o[1] += uy * len; o[2] += uz * len;
        d -= 30;
      }
    }
    // CL_AddExplosions: fullbright, the frame stepping at 10 a second from frame 1 (the newer of the two it lerped
    // between); ex_poly's skin climbs 0-4 over the first ten frames, then 5 and 6 translucent; ex_misc is translucent
    // throughout; translucency by the alpha as ref_soft had it (above 0.66 opaque, above 0.33 66%, else 33%). A
    // gunshot's smoke (ex_misc with RF_TRANSLUCENT alone) is lit where it hangs, its flash fullbright and opaque.
    for (const ex of this.explosions) {
      if (!ex.mdl && !ex.spr) continue;
      const frac = 1 + (time - ex.t0) * 10, f = Math.floor(frac);
      const translucent = ex.type === 'misc' || ex.type === 'smoke' || (ex.type === 'poly' && (f >= 10 || ex.spr));
      const blend = !translucent || ex.alpha > 0.66 ? 0 : ex.alpha > 0.33 ? 2 : 1;
      const frame = ex.base + f + 1;
      if (ex.mdl) {
        const skin = ex.type === 'poly' ? (f < 10 ? Math.max(0, f >> 1) : f < 13 ? 5 : 6) : 0;
        const smoke = ex.type === 'smoke';
        r.drawAlias(ex.mdl, Math.min(frame, ex.mdl.frames.length - 1), Math.min(skin, ex.mdl.skins.length - 1), [ex.x, ex.y, ex.z], [ex.pitch, ex.yaw, 0],
          smoke ? lightPoint(bsp, ex.x, ex.y, ex.z) : 255, { time, fullbright: !smoke, alpha: blend, dlight: smoke ? dlightAt(r.dlights, ex.x, ex.y, ex.z) : 0 });
      } else if (ex.spr) r.drawSprite(ex.spr, frame % ex.spr.frames.length, [ex.x, ex.y, ex.z], 255, blend);
    }
  }
}
