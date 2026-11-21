// standin.js – a body to draw for a model the pak lacks. The demo pak has no players/male/tris.md2, so in coop and
// deathmatch the other client (and a body left behind) was a model row without a mesh and the painter drew nothing:
// the soldier, a man of the player's size, stands in for it, his frame the one that does what the player's frame does
// (m_player.h's runs mapped onto the soldier's: standing, running, firing, pain, crouching, dying). A pak with the
// player model draws the model itself, as before.

/** m_player.h's runs: [name, first frame, frames]. */
export const PLAYER_RUNS = [['stand', 0, 40], ['run', 40, 6], ['attack', 46, 8], ['pain1', 54, 4], ['pain2', 58, 4], ['pain3', 62, 4],
  ['jump', 66, 6], ['flip', 72, 12], ['salute', 84, 11], ['taunt', 95, 17], ['wave', 112, 11], ['point', 123, 12], ['crstnd', 135, 19],
  ['crwalk', 154, 6], ['crattak', 160, 9], ['crpain', 169, 4], ['crdeath', 173, 5], ['death1', 178, 6], ['death2', 184, 6], ['death3', 190, 8]];

/** The soldier's run that stands in for each of the player's (the gestures stand; crouching holds the duck's last frame). */
const SOLDIER_RUN = { stand: 'stand1', run: 'run', attack: 'attak1', pain1: 'pain1', pain2: 'pain2', pain3: 'pain3', jump: 'run', flip: 'stand1',
  salute: 'stand1', taunt: 'stand1', wave: 'stand1', point: 'stand1', crstnd: 'duck', crwalk: 'duck', crattak: 'duck', crpain: 'duck',
  crdeath: 'death1', death1: 'death1', death2: 'death2', death3: 'death3' };
const HOLD_LAST = new Set(['crstnd', 'crwalk', 'crattak', 'crpain']);

export const PLAYER_MODEL = 'players/male/tris.md2';
export const STANDIN_MODEL = 'models/monsters/soldier/tris.md2';

/**
 * The stand-in's frame for a player model frame: the same run's place, stretched over the soldier's run (its first
 * frame to its last, so a death ends lying down). `runs` is the soldier's Md2.animations(). A frame past the player's
 * runs is the soldier's first standing frame.
 */
export function standInFrame(frame, runs) {
  const f = Math.max(0, Math.floor(frame));
  const p = PLAYER_RUNS.find(([, first, n]) => f >= first && f < first + n) ?? PLAYER_RUNS[0];
  const [name, first, n] = p;
  const s = runs.find((r) => r.name === SOLDIER_RUN[name]) ?? runs[0];
  if (!s) return 0;
  if (HOLD_LAST.has(name)) return s.first + s.count - 1;
  const off = f >= first && f < first + n ? f - first : 0;
  return s.first + (n > 1 ? Math.round((off * (s.count - 1)) / (n - 1)) : 0);
}

/**
 * What draws a model id that has no mesh (`res.placeholders`' rows): { mdl, frame(f) } for the player model when the
 * pak has the soldier, else null. Made once and kept on `res`.
 */
export function standIn(res, mid) {
  if (!res.standIns) {
    res.standIns = new Map();
    const id = res.placeholders?.get(PLAYER_MODEL);
    const soldier = res.models.get(res.byName.get(STANDIN_MODEL))?.mdl;
    if (id != null && soldier) {
      const runs = soldier.animations();
      res.standIns.set(id, { mdl: soldier, frame: (f) => standInFrame(f, runs) });
    }
  }
  return res.standIns.get(mid) ?? null;
}
