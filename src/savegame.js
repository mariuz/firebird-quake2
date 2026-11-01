// savegame.js – a saved game is the game's tables, copied out as rows and put back.
//
// The whole state of a level is six tables: game (the level), player (the clients), coop_respawn (what a coop
// respawn comes back with), ents (every edict), lightstyles (the switched lights) and player_trail (the spots
// the monsters follow). exportSave reads them; importSave, with the same map freshly loaded, empties them and
// inserts the saved rows, then restarts the entity id sequence above the highest id and forgets the frame's
// caches. Column names come from the result's field list, so the format follows the schema: a save from
// before a column loads with the column's default, one from before a table with the table empty, and a
// save carrying a column the schema has lost loads without it (the load names what it dropped). The version
// says what the schema meant at the time: an older save loads so, a newer one is refused.

export const SAVE_VERSION = 2;   // 1: the first saves; 2: game lost next_spawn, intermission_tics and finale, gained intermission_time, help_msg2, help_changed
// (a column added since loads defaulted in an older save, one removed since is dropped: bump the version only when a
// column's meaning changed, so a save of the old meaning can be told)
const TABLES = ['game', 'player', 'coop_respawn', 'ents', 'lightstyles', 'player_trail'];
// per-frame caches on ents that are rebuilt rather than saved
const SKIP = new Set(['FACES_LST', 'FL_STAMP', 'FL_X', 'FL_Y', 'FL_Z', 'FL_P', 'FL_YAW', 'FL_R', 'VIS_CL', 'VIS']);

/**
 * Read the saved-game tables. Returns a plain object fit for JSON. `levels` (a Map by map name of levels
 * left within the unit, from exportLevel) ride along, as Quake 2's save directory held every level's
 * .sav beside the game's (SV_WriteServerFile copied them in).
 */
export async function exportSave(db, mapName, levels = null) {
  const tables = {};
  for (const t of TABLES) {
    const r = await db.query(`SELECT * FROM ${t}`, [], { rowMode: 'array' });
    const names = r.fields.map((f) => (f.name ?? f.alias ?? f).toString().toUpperCase());
    const keep = names.map((n) => !SKIP.has(n));
    tables[t] = { cols: names.filter((_, i) => keep[i]), rows: r.rows.map((row) => row.filter((_, i) => keep[i])) };
  }
  // model ids by name: a reloaded map's models may get other ids, so the save carries the names
  const models = {};
  for (const [id, name] of (await db.query('SELECT id, name FROM models', [], { rowMode: 'array' })).rows) models[id] = name;
  // rnd()'s state, so the game goes on from the load with the chances it would have had
  const rng = (await db.query("SELECT RDB$GET_CONTEXT('USER_SESSION', 'rng') r FROM rdb$database")).rows[0].R;
  return { version: SAVE_VERSION, map: mapName, when: Date.now(), models, tables, rng: rng == null ? null : Number(rng), levels: levels ? Object.fromEntries(levels) : {} };
}

/** The unit's levels a save carries (but the save's own map, which the save itself holds), as a Map by name. */
export function savedLevels(save) {
  return new Map(Object.entries(save.levels ?? {}).filter(([name]) => name !== save.map));
}

/**
 * Put a saved game back. The save's map must already be loaded (loadMap / init_map): the
 * geometry and the models are the pak's, only the game tables are replaced.
 */
/**
 * Insert saved rows into a table, model ids remapped (and any other column's values by fix(col, value)).
 * One batch: since firebird-wasm 0.4.0 a number is bound in binary, so a DOUBLE PRECISION column gets
 * the saved double bit for bit (before, every parameter was text and Firebird's text-to-double conversion
 * was off by an ulp for one value in six: doubles went over as a mantissa and a power of two).
 */
async function insertRows(db, t, { cols, rows }, remap, fix = null) {
  if (!rows.length) return [];
  // the table's columns now: a saved column the schema has lost is dropped (and named), one the schema gained
  // is not inserted and takes its default
  const have = new Set((await db.query(`SELECT * FROM ${t} WHERE 1 = 0`, [], { rowMode: 'array' })).fields.map((f) => (f.name ?? f.alias ?? f).toString().toUpperCase()));
  const keep = cols.map((c) => have.has(String(c).toUpperCase()));
  const dropped = cols.filter((_, i) => !keep[i]);
  if (dropped.length) { cols = cols.filter((_, i) => keep[i]); rows = rows.map((r) => r.filter((_, i) => keep[i])); }
  const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const mi = cols.indexOf(t === 'game' ? 'WORLD_MODEL' : 'MODEL_ID');
  await db.execBatch(sql, rows.map((r) => {
    const row = r.slice();
    if (mi >= 0) row[mi] = remap(row[mi]);
    if (fix) for (let i = 0; i < cols.length; i++) row[i] = fix(cols[i], row[i]);
    return row;
  }));
  return dropped;
}

/** Read one table's rows (the frame caches left out). */
async function readRows(db, sqlText) {
  const r = await db.query(sqlText, [], { rowMode: 'array' });
  const names = r.fields.map((f) => (f.name ?? f.alias ?? f).toString().toUpperCase());
  const keep = names.map((n) => !SKIP.has(n));
  return { cols: names.filter((_, i) => keep[i]), rows: r.rows.map((row) => row.filter((_, i) => keep[i])) };
}

async function modelNames(db) {
  const models = {};
  for (const [id, name] of (await db.query('SELECT id, name FROM models', [], { rowMode: 'array' })).rows) models[id] = name;
  return models;
}

// ── a level left within the unit (SV_WriteLevelFile / SV_ReadLevelFile) ─────────────────────────
// Leaving a map by an ordinary exit, Quake 2 wrote the level's edicts, its level struct and the area portals'
// state, without the player (SV_GameMap marks the clients unused first); coming back, it read them in place of
// the map's fresh spawn and put the player in afresh at the spawn point it came in by. A unit's end, a new game
// or a loaded game forgets them all.

/** The clients' entity ids, in client order. */
async function playerEnts(db) {
  return (await db.query('SELECT ent_id FROM player WHERE ent_id IS NOT NULL ORDER BY id', [], { rowMode: 'array' })).rows.map((r) => r[0]);
}

/** The level as it stands, for coming back to it: its entities but the players', lights, portals and level counts. */
export async function exportLevel(db) {
  const pes = await playerEnts(db);
  return {
    playerIds: pes,
    models: await modelNames(db),
    game: (await db.query('SELECT tic, time_, total_monsters, killed, total_secrets, found_secrets, total_goals, found_goals FROM game WHERE id = 1')).rows[0],
    ents: await readRows(db, `SELECT * FROM ents WHERE id NOT IN (${pes.join(', ')})`),
    lightstyles: await readRows(db, 'SELECT * FROM lightstyles'),
    portals: await readRows(db, 'SELECT * FROM portal_state'),
  };
}

/**
 * Put a level left earlier back over the same map freshly loaded (not a new game): its entities in place of the
 * spawn's, its lights, portals, time and counts. The players the fresh load placed at the spawn points stay,
 * their ids moved above the level's, and whatever in the level pointed at a player then points at it now
 * (a level left with one client and come back to with two keeps the second where the fresh load put it).
 */
export async function importLevel(db, lv) {
  const byName = new Map((await db.query('SELECT id, name FROM models', [], { rowMode: 'array' })).rows.map(([id, name]) => [name, id]));
  const remap = (id) => { if (id == null) return id; const name = lv.models?.[id]; const nid = name == null ? undefined : byName.get(name); return nid ?? id; };
  const ids = lv.ents.rows.map((r) => r[lv.ents.cols.indexOf('ID')]);
  const oldPes = lv.playerIds ?? [lv.playerId];   // (a level left before coop: one player)
  const pes = await playerEnts(db);
  // above every id in play, the fresh load's whole table among them (a level entered by a spawn point puts the player amid
  // its entities, so the fresh ids run past it): the moves cannot collide
  const maxNow = (await db.query('SELECT MAX(id) m FROM ents')).rows[0]?.M ?? 0;
  const base = Math.max(...oldPes, ...ids, ...pes, maxNow) + 1;
  const newPe = new Map(pes.map((pe, i) => [pe, base + i]));   // the fresh load's ids → above the level's
  const moved = new Map(oldPes.map((old, i) => [old, base + i]));   // the level's references → the same clients
  let sql = '';
  for (const [pe, n] of newPe) sql += `UPDATE ents SET id = ${n} WHERE id = ${pe}; UPDATE player SET ent_id = ${n} WHERE ent_id = ${pe};`;
  await db.exec(`${sql} DELETE FROM sound_events; DELETE FROM fx_events; DELETE FROM vis_faces; DELETE FROM player_trail;
    DELETE FROM ents WHERE id NOT IN (${[...newPe.values()].join(', ')}); DELETE FROM lightstyles; DELETE FROM portal_state;`);
  const refs = new Set(['ENEMY_ID', 'GOAL_ID', 'OWNER_ID', 'MOVETARGET', 'LINKED_ID']);
  await insertRows(db, 'ents', lv.ents, remap, (c, v) => (refs.has(c) && moved.has(v) ? moved.get(v) : v));
  await insertRows(db, 'lightstyles', lv.lightstyles, remap);
  await insertRows(db, 'portal_state', lv.portals, remap);
  await db.exec(`ALTER SEQUENCE ent_seq RESTART WITH ${base + pes.length}`);
  const g = lv.game;
  await db.query(`UPDATE game SET tic = ${g.TIC}, time_ = ?, total_monsters = ${g.TOTAL_MONSTERS},
    killed = ${g.KILLED}, total_secrets = ${g.TOTAL_SECRETS}, found_secrets = ${g.FOUND_SECRETS}, total_goals = ${g.TOTAL_GOALS},
    found_goals = ${g.FOUND_GOALS} WHERE id = 1`, [g.TIME_]);
  // the players put in afresh at the level's time (PutClientInServer: air for twelve seconds), relinked; the
  // areas joined as the portals now stand; the frame's caches forgotten; the monsters' sight client found again
  await db.query(`EXECUTE BLOCK AS BEGIN
    UPDATE player p SET p.air_finished = (SELECT g.time_ FROM game g WHERE g.id = 1) + 12;
    ${[...newPe.values()].map((n) => `EXECUTE PROCEDURE link_ent(${n});`).join(' ')}
    EXECUTE PROCEDURE flood_areas;
    EXECUTE PROCEDURE ai_set_sight_client;
    UPDATE viewcfg SET vis_cluster = NULL, vis_area = NULL, lv_ex = NULL, lv_leaf = NULL, world_lst = NULL, view_stamp = view_stamp + 1;
  END`);
}

/** The load's note for the page: an older version, the columns dropped; '' for a save of this version with nothing dropped. */
export function saveNote(info) {
  const parts = [];
  if (info.version < SAVE_VERSION) parts.push(`a save of version ${info.version}`);
  for (const [t, cols] of Object.entries(info.dropped ?? {})) parts.push(`${t}'s ${cols.map((c) => c.toLowerCase()).join(', ')} dropped`);
  return parts.join('; ');
}

/** Returns { version, dropped: { table: [columns the schema has lost] } } for the page's note. */
export async function importSave(db, save) {
  if (!save || !Number.isInteger(save.version) || !save.tables) throw new Error('not a saved game of this port');
  if (save.version > SAVE_VERSION) throw new Error(`a saved game of a newer version (${save.version}, this is ${SAVE_VERSION})`);
  // the saved model ids → this load's, by name
  const byName = new Map((await db.query('SELECT id, name FROM models', [], { rowMode: 'array' })).rows.map(([id, name]) => [name, id]));
  const remap = (id) => { if (id == null) return id; const name = save.models?.[id]; const nid = name == null ? undefined : byName.get(name); return nid ?? id; };
  await db.exec('DELETE FROM sound_events; DELETE FROM fx_events; DELETE FROM vis_faces; DELETE FROM lightstyles; DELETE FROM player_trail; DELETE FROM ents; DELETE FROM coop_respawn; DELETE FROM player; DELETE FROM game; DELETE FROM usercmd;');
  const dropped = {};
  for (const t of TABLES) {
    if (!save.tables[t]) continue;   // a save from before the table: it starts empty
    const d = await insertRows(db, t, save.tables[t], remap);
    if (d.length) dropped[t] = d;
  }
  const maxId = (await db.query('SELECT MAX(id) m FROM ents')).rows[0].M ?? 0;
  await db.exec(`ALTER SEQUENCE ent_seq RESTART WITH ${maxId + 1}`);
  if (save.rng != null) await db.query("SELECT RDB$SET_CONTEXT('USER_SESSION', 'rng', ?) FROM rdb$database", [Math.floor(save.rng)]);
  // the frame's caches describe a view and a cluster that are gone
  await db.exec('UPDATE viewcfg SET vis_cluster = NULL, lv_ex = NULL, lv_leaf = NULL, world_lst = NULL, view_stamp = view_stamp + 1;');
  return { version: save.version, dropped };
}
