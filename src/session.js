// session.js – the game as the page plays it, without the page: a map started or returned to, a tic run,
// the frame read and decoded, the unit's levels kept, a game saved to a slot and loaded from one.
//
// What the server did in single player (SV_Map, SV_WriteLevelFile / SV_ReadLevelFile, SV_WriteServerFile /
// SV_ReadServerFile), with the page left to draw, play sounds and show status. `src/main.js` holds one and
// wires it to the DOM; `scripts/session-test.mjs` drives one in Node through the same calls.

import { loadMap, ensureFaceVerts } from './loader.js';
import { exportSave, importSave, exportLevel, importLevel, savedLevels } from './savegame.js';
import { packSave, unpackSave, saveHeader } from './savestore.js';
import { parseChangeMap } from './levels.js';

const ARR = { rowMode: 'array' };

/** The storage key of a save slot (0 is the autosave) and of the quick slot. */
export const SLOT_KEY = (i) => `firebird-quake2:save:save${i}`;
export const QUICK_KEY = 'firebird-quake2:save:quick';
export const SLOTS = 15;

/**
 * FRAME_ALL's rows (sql/render.sql), read into what the page draws and plays. Every row is tagged with
 * what it is: r = [kind, i1, i2, i3, i4, i5, d1, d2, d3, d4, d5, d6, d7, d8, s, lst].
 * `styleBase` holds the light styles' resting values; the frame lists only the ones that animate or switched.
 */
export function decodeFrame(rows, styleBase) {
  const faces = [], ents = [], sounds = [], fx = [], loops = [];
  const styles = styleBase.slice();
  const brushFrames = new Map(), brushAngles = new Map();
  let speakers = null;
  for (const r of rows) {
    switch (r[0]) {
      case 1: { const ent = r[2], ox = r[6], oy = r[7], oz = r[8]; for (const id of r[15].split(',')) faces.push([+id, ent, ox, oy, oz]); break; }
      case 8: faces.push([r[1], r[2], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[3]]); break;
      case 2: ents.push([r[1], r[2], r[3], r[4], r[6], r[7], r[8], r[9], r[10], r[11], r[5], r[12], r[14], r[13]]); break;
      case 3: if (r[15]) for (const kv of r[15].split(',')) { const i = kv.indexOf(':'); const st = +kv.slice(0, i); if (st < 64) styles[st] = (kv.charCodeAt(i + 1) - 97) / 12.5; } break;
      case 4: sounds.push([r[1], 0, r[2], r[3], r[14], r[6], r[7], r[8], r[9], r[10]]); break;
      case 5: fx.push([r[1], r[2], r[6], r[7], r[8], r[9], r[10], r[11], r[3]]); break;
      case 6: brushFrames.set(r[1], [r[2], r[3] ?? 0]); if (r[6] || r[7] || r[8]) brushAngles.set(r[1], [r[6], r[7], r[8]]); break;
      case 7: speakers = r[15] ? r[15].split(',').map(Number) : []; break;
      case 9: loops.push([r[14], r[8], r[9], r[10]]); break;
      default: break;
    }
  }
  return { faces, ents, sounds, fx, loops, styles, speakers, brushFrames, brushAngles };
}

export class Session {
  /**
   * @param {object} db         a FirebirdBrowser with the schema created
   * @param {object} [storage]  where the slots live (localStorage's getItem/setItem); none, no saves
   */
  constructor(db, storage = null) {
    this.db = db;
    this.storage = storage;
    this.pak = null;
    this.res = null;
    this.map = null;            // { name, bsp }
    this.last = null;           // the last Q2_TIC row: the first client's
    this.clients = [];          // every client's last Q2_TIC row, in client order (one in single player, two in coop or deathmatch)
    this.coop = false;
    this.deathmatch = false;
    this.players = 2;           // the clients a coop game or a deathmatch has (two to four)
    this.cvars = { dmflags: 0, fraglimit: 0, timelimit: 0 };   // the deathmatch cvars, given to each map load
    this.lastSoundId = 0;
    this.lastFxId = 0;
    this.frameNo = 0;
    this.styleBase = new Float32Array(64);
    /** The unit's levels left by an ordinary exit, by map name (SV_WriteLevelFile), to come back to as they were left. */
    this.unitLevels = new Map();
  }

  /** The pak and the resources loadResources made from it. */
  use(pak, res) {
    this.pak = pak;
    this.res = res;
    this.map = null;
    this.last = null;
  }

  /** The first map of a new game: the demo's, else the full game's. */
  firstMap() {
    return this.pak.has('maps/demo1.bsp') ? 'demo1' : 'base1';
  }

  /** Two or more clients at this game, in coop or against each other. */
  get twoPlayers() { return this.coop || this.deathmatch; }
  /** How many clients the game has: one, or `players` in coop or deathmatch. */
  get nclients() { return this.twoPlayers ? this.players : 1; }

  /**
   * Load a map. A new game forgets the unit's levels; a level of this unit left earlier comes back as it was
   * left (SV_ReadLevelFile), the players put in afresh at the spawn point. Returns what the page sets up from:
   * the sky, the CD track, the worldspawn and the looped speakers. `coop` puts more clients in (`players` of them,
   * two to four, at their info_player_coop), `deathmatch` as many against each other (at deathmatch spots, with
   * the cvars in `cvars`); either holds for the game, so a level change keeps it unless told otherwise.
   */
  async startMap(name, { newGame = false, spawnpoint = null, skill = 1, faceVerts = false, seed, coop = this.coop, deathmatch = this.deathmatch, players = this.players, cvars = this.cvars } = {}) {
    if (newGame) this.unitLevels.clear();
    this.deathmatch = !!deathmatch;
    this.coop = !!coop && !this.deathmatch;
    this.players = Math.max(2, Math.min(4, Math.floor(players) || 2));
    this.cvars = { ...this.cvars, ...cvars };
    const bsp = await loadMap(this.db, this.pak, this.res, name, { skill, newGame, spawnpoint, faceVerts, seed, coop: this.coop, deathmatch: this.deathmatch, players: this.players, ...this.cvars });
    if (!newGame && this.unitLevels.has(name)) await importLevel(this.db, this.unitLevels.get(name));
    this.map = { name, bsp };
    const g = (await this.db.query('SELECT sky, cd_track FROM game')).rows[0];
    await this.loadStyleBase();
    const speakers = (await this.db.query("SELECT id, x, y, z, noise1, sounds FROM ents WHERE classname = 'target_speaker' AND BIN_AND(spawnflags, 3) <> 0 AND noise1 IS NOT NULL", [], ARR)).rows;
    await this.resetEvents();
    // CL_SetSky: worldspawn's skyrotate and skyaxis (CS_SKYROTATE, CS_SKYAXIS)
    const ws = bsp.entities.find((e) => e.classname === 'worldspawn') ?? {};
    const skyAxis = ws.skyaxis ? ws.skyaxis.trim().split(/\s+/).map(Number).map((v) => (Number.isFinite(v) ? v : 0)) : [0, 0, 0];
    return { bsp, sky: g.SKY, cdTrack: Number(g.CD_TRACK ?? 0), skyRotate: Number(ws.skyrotate) || 0, skyAxis, speakers };
  }

  /** The light styles' resting values: the frame lists only the ones that animate or that the map has switched. */
  async loadStyleBase() {
    this.styleBase.fill(0);
    for (const [s, p] of (await this.db.query('SELECT style, pattern FROM lightstyles', [], ARR)).rows) if (s < 64 && p) this.styleBase[s] = (p.charCodeAt(0) - 97) / 12.5;
  }

  /** Sounds and effects from now on: the ones already in the tables were the old map's, or the save's. */
  async resetEvents() {
    const { rows } = await this.db.query('SELECT MAX(id) m FROM sound_events');
    this.lastSoundId = rows[0].M ?? 0;
    this.lastFxId = 0;
  }

  /**
   * Run tics with the usercmd's parameters (Input.read); the first client's row is `last`, every client's
   * in `clients`. The other clients of a coop game or a deathmatch send their usercmds as `cmds` (the same
   * shape, the tics ignored; the second client's first, a null for one that sends nothing): each is written to
   * USERCMD, which the tic reads for it.
   */
  async tic(cmd, ...cmds) {
    for (let i = 0; i < cmds.length; i++) {
      if (!cmds[i]) continue;
      await this.db.query(`UPDATE OR INSERT INTO usercmd (client, fwd, side, yaw_d, pitch_d, fire, jump, run, imp) VALUES (${i + 2}, ?, ?, ?, ?, ?, ?, ?, ?) MATCHING (client)`, cmds[i].slice(1));
    }
    this.clients = (await this.db.query('SELECT * FROM q2_tic(?, ?, ?, ?, ?, ?, ?, ?, ?)', cmd, { rowMode: 'object' })).rows;
    this.last = this.clients[0];
    return this.last;
  }

  /** The inventory screen's rows: [itemlist index, count], of the client (1 the first). */
  async inventory(client = 1) {
    return (await this.db.query(`SELECT idx, cnt FROM inventory_list(${client})`, [], ARR)).rows;
  }

  /**
   * The frame in one round trip (FRAME_ALL), decoded. The looped speakers are asked for every tenth frame.
   * `sqlRenderer` is the renderer mode that projects in SQL; its face vertices load the first time it asks.
   * `client` is whose view it is (1 the first): the other client's model is in it, its own is not.
   */
  async frame({ sqlRenderer = false, client = 1 } = {}) {
    const wantSpeakers = ++this.frameNo % 10 === 0;
    if (sqlRenderer && this.res.world && !this.res.world.faceVertsLoaded) await ensureFaceVerts(this.db, this.res);
    const rows = (await this.db.query(`SELECT * FROM frame_all(${sqlRenderer ? 1 : 0}, ${this.lastSoundId}, ${this.lastFxId}, ${wantSpeakers ? 1 : 0}, ${client})`, [], ARR)).rows;
    const f = decodeFrame(rows, this.styleBase);
    if (f.sounds.length) this.lastSoundId = f.sounds[f.sounds.length - 1][0];
    if (f.fx.length) this.lastFxId = f.fx[f.fx.length - 1][0];
    return f;
  }

  // ── a demo (src/demo.js) played over the loaded map: the view and the brush models the demo says, the faces from the SQL ─────

  /**
   * The map as a demo's stage: the game's own alias models and sprites hidden (the demo brings its own), the
   * brush models by name for the frames to move. Called once after startMap for the demo's map.
   */
  async demoBegin() {
    await this.db.exec("UPDATE ents SET mkind = NULL, model_id = NULL WHERE mkind IN ('M', 'S') AND classname <> 'player'");
    this.demoBrushes = new Map();
    for (const [name, id] of (await this.db.query("SELECT m.name, e.id FROM ents e JOIN models m ON m.id = e.model_id WHERE m.kind = 'B' AND m.name STARTING WITH '*'", [], ARR)).rows) this.demoBrushes.set(name, id);
    this.demoBrushState = new Map();
  }

  /**
   * One demo frame's faces: the player's entity and row set to the demo's view (the eye the SQL's frustum and PVS
   * take), each brush model the demo lists moved to where the demo has it (relinked when it moved), then the frame
   * query as for the page's own game. `view`: { x, y, z, viewZ, yaw, pitch }; `brushes`: [{ name, origin, angles, frame }].
   */
  async demoFrame(view, brushes = []) {
    const pe = (await this.db.query('SELECT ent_id FROM player WHERE id = 1')).rows[0].ENT_ID;
    await this.db.exec(`UPDATE ents SET x = ${view.x}, y = ${view.y}, z = ${view.z}, yaw = ${view.yaw}, vx = 0, vy = 0, vz = 0, deadflag = 0 WHERE id = ${pe};
      UPDATE player SET pitch = ${view.pitch}, view_ofs = ${view.viewZ - view.z}, stepz = 0, bob_z = 0, bob_pitch = 0, bob_roll = 0 WHERE id = 1;
      EXECUTE PROCEDURE link_ent(${pe})`);
    for (const b of brushes) {
      const id = this.demoBrushes?.get(b.name);
      if (!id) continue;
      const key = [b.origin, b.angles, b.frame, b.effects ?? 0].flat().map((v) => Math.round(v * 8)).join(',');
      if (this.demoBrushState.get(id) === key) continue;
      this.demoBrushState.set(id, key);
      await this.db.exec(`UPDATE ents SET x = ${b.origin[0]}, y = ${b.origin[1]}, z = ${b.origin[2]}, pitch = ${b.angles[0]}, yaw = ${b.angles[1]}, roll = ${b.angles[2]}, frame = ${b.frame}, effects = ${b.effects ?? 0} WHERE id = ${id}; EXECUTE PROCEDURE link_ent(${id})`);
    }
    return this.frame({ client: 1 });
  }

  /** The frame's spare time marks the cluster the player is heading into (premark_ahead). */
  async premark() {
    await this.db.query('SELECT marked FROM premark_ahead');
  }

  /** The death screen's fire was pressed (exit_kind 3): the load menu, once. */
  async takeLoadRequest() {
    if (this.last?.EXIT_KIND !== 3) return false;
    await this.db.exec('UPDATE game SET exit_kind = 0 WHERE id = 1');
    return true;
  }

  /**
   * Leave the level for `target` (a target_changelevel's map string, src/levels.js): a unit's end forgets
   * the unit's levels and its cross-level flags (they last "within the same unit", g_target.c); any other
   * exit keeps the one being left. Returns the parsed target; the page shows a picture or loads the map.
   */
  async leave(target) {
    const c = parseChangeMap(target);
    // SaveClientData: the clients' health, max health and god or notarget flags come along to the next level
    await this.db.exec('EXECUTE PROCEDURE save_client_data');
    if (c.unitEnd) this.unitLevels.clear();
    else if (this.map) this.unitLevels.set(this.map.name, await exportLevel(this.db));
    if (c.unitEnd) await this.db.exec('UPDATE game SET serverflags = 0 WHERE id = 1');
    return c;
  }

  // ── saves: the game tables and the unit's other levels, gzipped JSON in the slots (src/savestore.js) ────

  /** The level's name for a save's comment: the worldspawn message, else the map. */
  async levelName() {
    const g = (await this.db.query('SELECT level_msg FROM game')).rows[0];
    return (g?.LEVEL_MSG ?? '').trim() || this.map.name;
  }

  /** Write the game to `key`, with its comment; returns the stored size. */
  async writeSave(key, comment) {
    if (!this.storage) throw new Error('no storage for saves');
    const save = await exportSave(this.db, this.map.name, this.unitLevels);
    save.comment = comment;
    const text = await packSave(save);   // gzip + base64: a tenth of the JSON, and the slots fit the origin's quota
    this.storage.setItem(key, text);
    return text.length;
  }

  /** The save at `key`, or null when there is none or it does not read. */
  async readSave(key) {
    try { return await unpackSave(this.storage?.getItem(key)); } catch { return null; }
  }

  /** The slots' headers for the load and save menus, read without inflating anything. */
  slots() {
    return Array.from({ length: SLOTS }, (_, i) => {
      try {
        const s = saveHeader(this.storage?.getItem(SLOT_KEY(i)));
        return s ? { valid: true, name: s.comment ?? s.map } : { valid: false };
      } catch { return { valid: false }; }
    });
  }

  /**
   * Load a save: its map's geometry and models afresh, then its rows, then the unit's other levels as it
   * left them. Throws when its map is not in the pak.
   */
  async loadSave(save, { skill = 1, faceVerts = false } = {}) {
    if (!this.pak.has(`maps/${save.map}.bsp`)) throw new Error(`The saved game is on ${save.map}, which is not in this pak`);
    this.unitLevels.clear();
    const setup = await this.startMap(save.map, { skill, faceVerts });
    await importSave(this.db, save);
    const g = (await this.db.query('SELECT coop, deathmatch, (SELECT COUNT(*) FROM player) n FROM game')).rows[0];   // the save's game: one player's, coop or deathmatch, with its clients
    this.coop = g?.COOP === 1;
    this.deathmatch = g?.DEATHMATCH === 1;
    if (this.twoPlayers) this.players = Math.max(2, Math.min(4, Number(g?.N ?? 2)));
    for (const [name, lv] of savedLevels(save)) this.unitLevels.set(name, lv);
    await this.loadStyleBase();
    await this.resetEvents();
    return setup;
  }
}
