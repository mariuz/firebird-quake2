// console.js – Quake's console line: the commands the page runs itself (map, fov, seed, save, load,
// inven, bind and its kin over the keys menu's binds, rtc_ice …) and the rest handed to the game's player_command (god, noclip, give, use, kill, drop …);
// the history (Key_Console: up and down step through the lines typed) and Tab completion
// (Cmd_CompleteCommand: the first command that starts with what is typed).
//
// Nothing here touches the DOM: the page wires the input element to historyStep(), complete() and
// submit(), and gives a host with what the commands act on, so the tests can drive it with a fake one.

import { parseIceServer } from './net.js';
import { ACTIONS, actionOfCommand, bindKey, keyCode, keyName } from './input.js';

export const COMMANDS = ['bind', 'bindlist', 'deldemo', 'demomap', 'demos', 'dmflags', 'drop', 'fov', 'fraglimit', 'give', 'god', 'inven', 'invnext', 'invprev', 'invuse', 'kill', 'load', 'map', 'noclip', 'notarget', 'record', 'rtc_ice', 'rtc_signal', 'save', 'say', 'say_team', 'screenshot', 'seed', 'skill', 'spectator', 'stop', 'timedemo', 'timelimit', 'unbind', 'unbindall', 'use'];
const HISTORY = 32;

/**
 * host: { db, pak, settings, saveSettings(), setStatus(msg, isError), startMap(name), setView(fov),
 *         saveGame(), loadGame(), toggleInventory(), isRunning(), setCvar(name, value), setSkill(n), playDemo(name),
 *         hasDemo(name), listDemos() → { pak, kept }, dropDemo(name) → dropped, record(name), stopRecord(), isRecording(),
 *         setSpectator(on | null) → 0 | 1 | null (null: this page has not joined a game), timedemo(name), screenshot(), say(text) }
 */
export class Console {
  constructor(host) {
    this.host = host;
    this.history = [];
    this.histPos = 0;
    this.said = 0;   // the messages said, for their clearing timers
  }

  /** Opening the line: the history cursor past its end. */
  reset() { this.histPos = this.history.length; }

  /** Up (-1) or down (+1) through the lines typed before; past the newest is the empty line. */
  historyStep(dir) {
    this.histPos = Math.max(0, Math.min(this.history.length, this.histPos + dir));
    return this.history[this.histPos] ?? '';
  }

  /** Cmd_CompleteCommand: what the line becomes on Tab, or null when nothing completes it. */
  complete(typed) {
    const t = typed.trim().toLowerCase();
    if (!t || t.includes(' ')) return null;
    const hit = COMMANDS.find((c) => c.startsWith(t));
    return hit ? hit + ' ' : null;
  }

  /** Enter: the line into the history (not twice in a row, the oldest forgotten past 32) and run. */
  async submit(line) {
    line = line.trim();
    if (line && this.history[this.history.length - 1] !== line) this.history.push(line);
    if (this.history.length > HISTORY) this.history.shift();
    this.histPos = this.history.length;
    if (line) await this.run(line);
  }

  async run(line) {
    const h = this.host;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');
    // (a message clears itself after its time unless a newer one has taken the line: an earlier message's timer
    // used to clear whatever was showing)
    const say = (msg, isError = false, ms = 2500) => { h.setStatus(msg, isError); const id = ++this.said; setTimeout(() => { if (this.said === id) h.setStatus(''); }, ms); };
    switch (cmd.toLowerCase()) {
      case 'map': {
        const name = arg.toLowerCase();
        if (!h.pak.has(`maps/${name}.bsp`)) { say(`no map "${name}" in this pak`, true); return; }
        await h.startMap(name);
        return;
      }
      case 'demomap': {
        // CL_PlayDemo_f: a demo of the pak (demos/<name>.dm2), or one recorded this session, played over its map
        const name = arg.toLowerCase().replace(/\.dm2$/, '');
        const has = h.hasDemo ? h.hasDemo(name) : h.pak.has(`demos/${name}.dm2`);
        if (!name || !has) { say(`no demo "${name}" in this pak`, true); return; }
        await h.playDemo?.(name);
        return;
      }
      case 'timedemo': {
        // CL_Timedemo_f: the demo played a frame of the recording a painted frame, no pacing, the frames and the seconds
        // reported at its end as CL_DemoCompleted reported them
        const name = arg.toLowerCase().replace(/\.dm2$/, '');
        const has = h.hasDemo ? h.hasDemo(name) : h.pak.has(`demos/${name}.dm2`);
        if (!name || !has) { say(`no demo "${name}" in this pak`, true); return; }
        await h.timedemo?.(name);
        return;
      }
      case 'say': case 'say_team': {
        // Cmd_Say_f: the words to every client's message line as "name: text", as typed and not the console's lower
        // case (a guest's go to the host; say_team is say, there being no model or skin teams here)
        if (!arg) { say(`${cmd.toLowerCase()} <text>`, true); return; }
        if (!h.isRunning()) return;
        await h.say?.(arg);
        return;
      }
      case 'screenshot':
        // SCR_ScreenShot_f: the view as a picture (quakeNN.png here, downloaded), as it stands
        if (!h.isRunning()) { say('screenshot: nothing is on the view', true); return; }
        h.screenshot?.();
        return;
      case 'demos': {
        // the page's own: the pak's demos and the recordings kept (this session's, and the earlier ones' from the store)
        const d = h.listDemos?.() ?? { pak: [], kept: [] };
        say(`demos: ${d.pak.length ? d.pak.join(', ') : 'none in the pak'}; recorded: ${d.kept.length ? d.kept.join(', ') : 'none'}`, false, 5000);
        return;
      }
      case 'deldemo': {
        // the page's own: a kept recording dropped, from the select and the store; the pak's demos are not the page's to drop
        const name = arg.toLowerCase().replace(/\.dm2$/, '');
        if (!name) { say('deldemo <demoname>', true); return; }
        if (!(await h.dropDemo?.(name))) { say(`no recording "${name}"`, true); return; }
        say(`${name} dropped`);
        return;
      }
      case 'record': {
        // CL_Record_f: the game from here on written as a demo (src/record.js), until `stop` or the level's end
        const name = arg.toLowerCase().replace(/\.dm2$/, '').replace(/[^a-z0-9_-]/g, '');
        if (!name) { say('record <demoname>', true); return; }
        if (h.isRecording?.()) { say('Already recording.', true); return; }
        if (!h.isRunning()) { say('You must be in a level to record.', true); return; }
        await h.record?.(name);
        return;
      }
      case 'stop':
        // CL_Stop_f: the demo written out (the page downloads it and keeps it in the Demo select)
        if (!h.isRecording?.()) { say('Not recording a demo.', true); return; }
        await h.stopRecord?.();
        return;
      case 'inven': h.toggleInventory(); return;
      case 'fov': {
        // the client's fov, clamped as ClientUserinfoChanged clamped it (1-160); no argument shows it
        const v = Number(arg);
        if (!arg || !Number.isFinite(v)) { say(`"fov" is "${h.settings.fov}"`); return; }
        h.settings.fov = Math.max(1, Math.min(160, Math.round(v)));
        h.saveSettings();
        await h.setView(h.settings.fov);
        return;
      }
      case 'seed': {
        // the game's chances come from a seeded generator (rnd() in game.sql): no argument shows the seed this game
        // began with and the generator's state now; a number seeds the next new game, so a run can be played again
        if (!arg) {
          const g = (await h.db.query("SELECT g.rng_seed s, RDB$GET_CONTEXT('USER_SESSION', 'rng') r FROM game g WHERE g.id = 1")).rows[0];
          say(`seed ${g?.S ?? '?'} (the generator is at ${g?.R ?? '?'})`, false, 4000);
          return;
        }
        const v = Number(arg);
        if (!Number.isFinite(v)) { say('seed takes a number', true); return; }
        const seed = Math.floor(v) >>> 0;
        await h.db.query("SELECT RDB$SET_CONTEXT('USER_SESSION', 'rng', ?) FROM rdb$database", [seed]);
        say(`the next new game starts from seed ${seed}`);
        return;
      }
      case 'skill': {
        // the skill cvar: no argument shows it; 0 easy, 1 medium, 2 hard, 3 nightmare (SpawnEntities clamped it so),
        // and nightmare only from here, as the menus stop at hard. It was latched (CVAR_LATCH in g_main.c): set with
        // a game running it took hold at the next map, "skill will be changed for next game."
        if (!arg) { say(`"skill" is "${h.settings.skill}"`); return; }
        const v = Number(arg);
        if (!Number.isFinite(v)) { say('skill takes a number: 0 easy, 1 medium, 2 hard, 3 nightmare', true); return; }
        const value = Math.max(0, Math.min(3, Math.floor(v)));
        h.settings.skill = value;
        h.saveSettings();
        h.setSkill?.(value);
        say(h.isRunning() ? 'skill will be changed for next game.' : `"skill" is "${value}"`);
        return;
      }
      case 'spectator': {
        // 3.20's spectator userinfo, for a page that has joined a game: no argument shows it, 0 or 1 sets it (the host
        // puts the client back in as a watcher with no body, or as a player again)
        const now = h.setSpectator?.(null);
        if (now === null || now === undefined) { say('spectator: only a page that has joined a game can watch', true); return; }
        if (!arg) { say(`"spectator" is "${now}"`); return; }
        const v = Number(arg);
        if (!Number.isFinite(v)) { say('spectator takes 0 or 1', true); return; }
        h.setSpectator(v !== 0);
        say(v !== 0 ? 'spectator: watching' : 'spectator: playing again');
        return;
      }
      case 'rtc_ice': {
        // the ICE server the next network game adds to the STUN, for the networks a STUN cannot cross (a TURN relay:
        // `rtc_ice turn:host:3478 user pass`); no argument shows it, `none` clears it. Kept in the settings.
        if (!arg) { say(`"rtc_ice" is "${h.settings.rtcIce || 'none'}"`); return; }
        if (/^(none|off|0)$/i.test(arg)) { h.settings.rtcIce = ''; h.saveSettings(); say('rtc_ice: the STUN server alone'); return; }
        try { parseIceServer(arg); } catch (err) { say(`rtc_ice: ${err.message}`, true); return; }
        h.settings.rtcIce = arg.trim().split(/\s+/).join(' ');
        h.saveSettings();
        say(`rtc_ice: ${h.settings.rtcIce.split(' ')[0]} for the next network game`);
        return;
      }
      case 'rtc_signal': {
        // the signalling relay (scripts/signal.mjs) the next network game passes its offer and answer through under a
        // room code, in place of the texts; no argument shows it, `none` clears it. Kept in the settings; both pages set it.
        if (!arg) { say(`"rtc_signal" is "${h.settings.rtcSignal || 'none'}"`); return; }
        if (/^(none|off|0)$/i.test(arg)) { h.settings.rtcSignal = ''; h.saveSettings(); say('rtc_signal: the offer and the answer as texts'); return; }
        if (!/^https?:\/\/\S+$/i.test(arg) || arg.length > 300) { say("rtc_signal takes the relay's http(s) url", true); return; }
        h.settings.rtcSignal = arg.replace(/\/+$/, '');
        h.saveSettings();
        say(`rtc_signal: ${h.settings.rtcSignal} for the next network game`);
        return;
      }
      case 'bind': {
        // Key_Bind_f over the keys menu's binds (settings.binds): `bind <key> <command>` binds the key (named as the keys menu
        // names it: k, 3, UPARROW, CTRL, MOUSE1, KP_5…) to the action whose command that is (+attack, weapnext, use silencer…),
        // as bindKey binds it; `bind <key>` shows the key's binding. A key or a command the page has not is refused.
        const [key, ...words] = arg.split(/\s+/).filter(Boolean);
        if (!key) { say('bind <key> [command] : attach a command to a key', true); return; }
        const code = keyCode(key);
        if (!code) { say(`"${key}" isn't a valid key`, true); return; }
        const binds = h.settings.binds;
        if (!words.length) { const a = ACTIONS.find((x) => binds[x.id]?.includes(code)); say(a ? `"${keyName(code)}" = "${a.cmd}"` : `"${keyName(code)}" is not bound`); return; }
        const act = actionOfCommand(words.join(' '));
        if (!act) { say(`"${words.join(' ')}" is not a command this page binds: ${ACTIONS.map((a) => a.cmd).join(', ')}`, true, 8000); return; }
        bindKey(binds, act.id, code);
        h.saveSettings();
        say(`"${keyName(code)}" = "${act.cmd}"`);
        return;
      }
      case 'unbind': {
        // Key_Unbind_f: the key leaves whatever it was bound to
        if (!arg) { say('unbind <key> : remove commands from a key', true); return; }
        const code = keyCode(arg);
        if (!code) { say(`"${arg}" isn't a valid key`, true); return; }
        for (const a of ACTIONS) if (h.settings.binds[a.id]) h.settings.binds[a.id] = h.settings.binds[a.id].filter((c) => c !== code);
        h.saveSettings();
        say(`"${keyName(code)}" unbound`);
        return;
      }
      case 'unbindall': {
        // Key_Unbindall_f: every action loses its keys (the keys menu's reset defaults, or bind, gives them back)
        for (const a of ACTIONS) h.settings.binds[a.id] = [];
        h.saveSettings();
        say('all keys unbound');
        return;
      }
      case 'bindlist': {
        // Key_Bindlist_f: every key bound with its command, in the actions' order, on the one line the page has
        const lines = [];
        for (const a of ACTIONS) for (const c of h.settings.binds[a.id] ?? []) lines.push(`${keyName(c)} "${a.cmd}"`);
        say(lines.length ? lines.join(' · ') : 'no keys bound', false, 8000);
        return;
      }
      case 'save': return h.saveGame();
      case 'load': return h.loadGame();
      case 'dmflags': case 'fraglimit': case 'timelimit': {
        // the deathmatch cvars: no argument shows one; a number sets it for the game running and the next ones
        const name = cmd.toLowerCase();
        const v = Number(arg);
        if (!arg || !Number.isFinite(v)) { say(`"${name}" is "${h.settings[name]}"`); return; }
        const value = Math.max(0, Math.min(name === 'dmflags' ? 65535 : 999, Math.floor(v)));
        h.settings[name] = value;
        h.saveSettings();
        await h.setCvar?.(name, value);
        return;
      }
      default:
        if (!h.isRunning()) return;
        try { await h.db.query('SELECT msg FROM player_command(?, ?)', [cmd, arg]); }
        catch (err) { console.error(err); say(`${cmd}: ${err.message}`, true); }
    }
  }
}
