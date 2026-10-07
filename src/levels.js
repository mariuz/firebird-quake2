// levels.js – what a target_changelevel's "map" asks for, read the way the server read it
// (SV_Map in sv_init.c and SV_GameMap in sv_ccmds.c):
//
//   "demo2$base1"        the map demo2, arriving at the info_player_start named base1
//   "*base1"             the end of a unit: the game stops at the intermission first, then base1
//   "victory.pcx"        a picture, until a key
//   "ntro.cin+base1"     a cinematic, then base1 (cinematics are not played here: straight to base1)
//
// The game (SQL) decides on the intermission from the '*' alone, as BeginIntermission did; the page
// does the rest of the server's work with what this returns.

/** @returns {{ kind: 'map'|'pic'|'cinematic'|'demo', map: string, spawn: string|null, unitEnd: boolean, then: string|null }} */
export function parseChangeMap(target) {
  let level = String(target ?? '').trim();
  // a '+': what comes after the first part ("nextserver")
  let then = null;
  const plus = level.indexOf('+');
  if (plus >= 0) { then = level.slice(plus + 1) || null; level = level.slice(0, plus); }
  // a '$': the spawn point
  let spawn = null;
  const dollar = level.indexOf('$');
  if (dollar >= 0) { spawn = level.slice(dollar + 1) || null; level = level.slice(0, dollar); }
  // a leading '*': the end of a unit
  const unitEnd = level.startsWith('*');
  if (unitEnd) level = level.slice(1);
  level = level.toLowerCase();
  const kind = level.endsWith('.pcx') ? 'pic' : level.endsWith('.cin') ? 'cinematic' : level.endsWith('.dm2') ? 'demo' : 'map';
  return { kind, map: level, spawn, unitEnd, then };
}
