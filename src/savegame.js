// savegame.js – a saved game is the game's tables, copied out as rows and put back.
//
// The whole state of a level is five tables: game (the level), player (the client), ents (every
// edict), lightstyles (the switched lights) and player_trail (the spots the monsters follow). exportSave reads them; importSave, with the same
// map freshly loaded, empties them and inserts the saved rows, then restarts the entity id
// sequence above the highest id and forgets the frame's caches. Column names come from the
// result's field list, so the format follows the schema.

export const SAVE_VERSION = 2;   // 2: game lost next_spawn, intermission_tics and finale; gained intermission_time, help_msg2, help_changed
const TABLES = ['game', 'player', 'ents', 'lightstyles', 'player_trail'];
// per-frame caches on ents that are rebuilt rather than saved
const SKIP = new Set(['FACES_LST', 'FL_STAMP', 'FL_X', 'FL_Y', 'FL_Z', 'FL_P', 'FL_YAW', 'FL_R', 'VIS_CL', 'VIS']);

/** Read the saved-game tables. Returns a plain object fit for JSON. */
export async function exportSave(db, mapName) {
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
  return { version: SAVE_VERSION, map: mapName, when: Date.now(), models, tables };
}

/**
 * Put a saved game back. The save's map must already be loaded (loadMap / init_map): the
 * geometry and the models are the pak's, only the game tables are replaced.
 */
/** A double as [mantissa, exponent] with v = m × 2^e and m an integer below 2^53 (null stays null). */
function exactDouble(v) {
  if (v == null) return [null, 0];
  if (Number.isInteger(v) && Math.abs(v) < 2 ** 53) return [v, 0];
  let e = Math.floor(Math.log2(Math.abs(v))) - 52;
  while (e > -1074 && !Number.isInteger(v / 2 ** e)) e--;
  return [v / 2 ** e, e];
}

/** Insert saved rows into a table, model ids remapped (and any other column's values by fix(col, value)). */
async function insertRows(db, t, { cols, rows }, remap, fix = null) {
  // Parameters reach Firebird as text, and its text-to-double conversion is not correctly rounded (one
  // value in six came back an ulp off). A DOUBLE PRECISION column goes over as an integer mantissa and a
  // power of two instead, which converts exactly.
  const dbl = new Set((await db.query(`SELECT TRIM(rf.rdb$field_name) FROM rdb$relation_fields rf JOIN rdb$fields f ON f.rdb$field_name = rf.rdb$field_source
     WHERE rf.rdb$relation_name = ? AND f.rdb$field_type = 27`, [t.toUpperCase()], { rowMode: 'array' })).rows.map(([n]) => n));
  const isDbl = cols.map((c) => dbl.has(c));
  const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${isDbl.map((d) => d ? 'CAST(? AS DOUBLE PRECISION) * POWER(2e0, ?)' : '?').join(', ')})`;
  const mi = cols.indexOf(t === 'game' ? 'WORLD_MODEL' : 'MODEL_ID');
  for (let row of rows) {
    row = row.slice();
    if (mi >= 0) row[mi] = remap(row[mi]);
    if (fix) for (let i = 0; i < cols.length; i++) row[i] = fix(cols[i], row[i]);
    await db.query(sql, row.flatMap((v, i) => isDbl[i] ? exactDouble(v) : [v]));
  }
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

/** The level as it stands, for coming back to it: its entities but the player, lights, portals and level counts. */
export async function exportLevel(db) {
  const pe = (await db.query('SELECT ent_id FROM player WHERE id = 1')).rows[0].ENT_ID;
  return {
    playerId: pe,
    models: await modelNames(db),
    game: (await db.query('SELECT tic, time_, total_monsters, killed, total_secrets, found_secrets, total_goals, found_goals FROM game WHERE id = 1')).rows[0],
    ents: await readRows(db, `SELECT * FROM ents WHERE id <> ${pe}`),
    lightstyles: await readRows(db, 'SELECT * FROM lightstyles'),
    portals: await readRows(db, 'SELECT * FROM portal_state'),
  };
}

/**
 * Put a level left earlier back over the same map freshly loaded (not a new game): its entities in place of the
 * spawn's, its lights, portals, time and counts. The player the fresh load placed at the spawn point stays, its
 * id moved above the level's, and whatever in the level pointed at the player then points at it now.
 */
export async function importLevel(db, lv) {
  const byName = new Map((await db.query('SELECT id, name FROM models', [], { rowMode: 'array' })).rows.map(([id, name]) => [name, id]));
  const remap = (id) => { if (id == null) return id; const name = lv.models?.[id]; const nid = name == null ? undefined : byName.get(name); return nid ?? id; };
  const ids = lv.ents.rows.map((r) => r[lv.ents.cols.indexOf('ID')]);
  const newPe = Math.max(lv.playerId, ...ids) + 1;
  const pe = (await db.query('SELECT ent_id FROM player WHERE id = 1')).rows[0].ENT_ID;
  await db.exec(`UPDATE ents SET id = ${newPe} WHERE id = ${pe}; UPDATE player SET ent_id = ${newPe} WHERE id = 1;`);
  await db.exec(`DELETE FROM sound_events; DELETE FROM fx_events; DELETE FROM vis_faces; DELETE FROM player_trail; DELETE FROM ents WHERE id <> ${newPe};
    DELETE FROM lightstyles; DELETE FROM portal_state;`);
  const refs = new Set(['ENEMY_ID', 'GOAL_ID', 'OWNER_ID', 'MOVETARGET', 'LINKED_ID']);
  await insertRows(db, 'ents', lv.ents, remap, (c, v) => (refs.has(c) && v === lv.playerId ? newPe : v));
  await insertRows(db, 'lightstyles', lv.lightstyles, remap);
  await insertRows(db, 'portal_state', lv.portals, remap);
  await db.exec(`ALTER SEQUENCE ent_seq RESTART WITH ${newPe + 1}`);
  const g = lv.game;
  await db.query(`UPDATE game SET tic = ${g.TIC}, time_ = CAST(? AS DOUBLE PRECISION) * POWER(2e0, ?), total_monsters = ${g.TOTAL_MONSTERS},
    killed = ${g.KILLED}, total_secrets = ${g.TOTAL_SECRETS}, found_secrets = ${g.FOUND_SECRETS}, total_goals = ${g.TOTAL_GOALS},
    found_goals = ${g.FOUND_GOALS} WHERE id = 1`, exactDouble(g.TIME_));
  // the player put in afresh at the level's time (PutClientInServer: air for twelve seconds), relinked; the
  // areas joined as the portals now stand; the frame's caches forgotten
  await db.query(`EXECUTE BLOCK AS BEGIN
    UPDATE player p SET p.air_finished = (SELECT g.time_ FROM game g WHERE g.id = 1) + 12 WHERE p.id = 1;
    EXECUTE PROCEDURE link_ent(${newPe});
    EXECUTE PROCEDURE flood_areas;
    UPDATE viewcfg SET vis_cluster = NULL, vis_area = NULL, lv_ex = NULL, lv_leaf = NULL, world_lst = NULL, view_stamp = view_stamp + 1;
  END`);
}

export async function importSave(db, save) {
  if (!save || save.version !== SAVE_VERSION) throw new Error('not a saved game of this version');
  // the saved model ids → this load's, by name
  const byName = new Map((await db.query('SELECT id, name FROM models', [], { rowMode: 'array' })).rows.map(([id, name]) => [name, id]));
  const remap = (id) => { if (id == null) return id; const name = save.models?.[id]; const nid = name == null ? undefined : byName.get(name); return nid ?? id; };
  await db.exec('DELETE FROM sound_events; DELETE FROM fx_events; DELETE FROM vis_faces; DELETE FROM lightstyles; DELETE FROM player_trail; DELETE FROM ents; DELETE FROM player; DELETE FROM game;');
  for (const t of TABLES) {
    if (!save.tables[t]) continue;   // a save from before the table: it starts empty
    await insertRows(db, t, save.tables[t], remap);
  }
  const maxId = (await db.query('SELECT MAX(id) m FROM ents')).rows[0].M ?? 0;
  await db.exec(`ALTER SEQUENCE ent_seq RESTART WITH ${maxId + 1}`);
  // the frame's caches describe a view and a cluster that are gone
  await db.exec('UPDATE viewcfg SET vis_cluster = NULL, lv_ex = NULL, lv_leaf = NULL, world_lst = NULL, view_stamp = view_stamp + 1;');
}
