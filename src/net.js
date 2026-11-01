// net.js – two pages share one game over a WebRTC data channel: the host's page runs the game in its
// Firebird as it does alone, the guest sends its usercmd each tic and gets its frame back.
//
// What sv_main.c and cl_main.c were to each other: the host is the server (its Session runs q2_tic with
// every client's command, as a local coop game already does with the gamepad's) and the guest is a client
// that paints what it is sent (the rows frame_all(…, client) returns for it, decoded as the page decodes its
// own), hears the sounds of the tic at its own ear and shows its own player row on the status bar. The
// guest's page loads the pak for the textures, models and pictures and the map's geometry for the painter
// (loadMapModels), and runs no game logic but its own move: each command carries a sequence number, each
// frame the newest the tic took (`ack`), and the guest runs the commands past it through src/pmove.js from
// the frame's row (CL_PredictMovement), so its own move shows at once and not a round trip late; the frame
// carries the box entities about the guest (the monsters, the other clients) for it to clip against.
//
// The wire is JSON over a data channel, in chunks a channel is sure to take (16 KB); a frame of demo1 is
// 10–30 KB, one or two chunks, twenty times a second. Signalling is by hand: Pages is static, so the offer
// and the answer are texts the players pass each other (gzipped and base64'd, under a kilobyte each), with
// the ICE candidates gathered before the text is made; or through a relay of the player's own
// (scripts/signal.mjs, SignalClient here) under a room code. HostLink and GuestLink know nothing of WebRTC:
// a test runs them over Loopback.pair() in one process.

export const CHUNK = 16000;           // characters a data channel message is kept under
export const BACKLOG = 256 * 1024;    // bytes queued on the channel before frames are dropped (a slow link)
/** SV_UserinfoChanged's clamp on the rate userinfo (100..25000 there; 1000..1000000 here, a frame being the face list), 500000 for none. */
export const clampRate = (rate) => { const n = Number(rate); return Number.isFinite(n) && n > 0 ? Math.max(1000, Math.min(1000000, Math.round(n))) : 500000; };
/** The skin userinfo as model/skin (at most fifteen characters each), male/grunt for anything else. */
export const skinOf = (skin) => (/^[\w-]{1,15}\/[\w-]{1,15}$/.test(String(skin ?? '')) ? String(skin) : 'male/grunt');
const SIGNAL_MAGIC = 'q2net1:';

/** JSON messages over a channel-like object ({ send(text), onmessage, onclose, bufferedAmount }), chunked. */
export class Link {
  constructor(channel) {
    this.ch = channel;
    this.open = true;
    this.onMessage = null;
    this.onClose = null;
    this.parts = null;    // the chunks of a message being received
    channel.onmessage = (e) => this.receive(typeof e === 'string' ? e : e.data);
    channel.onclose = () => { if (this.open) { this.open = false; this.onClose?.(); } };
  }
  get buffered() { return this.ch.bufferedAmount ?? 0; }
  /** Sends the message; returns its size in characters (0 when the link is closed), the rate's count. */
  send(obj) {
    if (!this.open) return 0;
    const text = JSON.stringify(obj);
    // (a channel closing under a send throws before its close event comes: the link is closed here)
    try {
      if (text.length <= CHUNK) { this.ch.send(text); return text.length; }
      const n = Math.ceil(text.length / CHUNK);
      for (let i = 0; i < n; i++) this.ch.send(`#${n}:${i}:${text.slice(i * CHUNK, (i + 1) * CHUNK)}`);
    } catch { this.close(); }
    return text.length;
  }
  receive(text) {
    if (text[0] === '#') {
      const a = text.indexOf(':'), b = text.indexOf(':', a + 1);
      const n = +text.slice(1, a), i = +text.slice(a + 1, b);
      if (!this.parts || this.parts.length !== n) this.parts = new Array(n).fill(null);
      this.parts[i] = text.slice(b + 1);
      if (this.parts.some((p) => p === null)) return;
      text = this.parts.join('');
      this.parts = null;
    }
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    this.onMessage?.(msg, text.length);   // (the size with it: cl_shownet's print)
  }
  close() {
    if (!this.open) return;
    this.open = false;
    try { this.ch.close?.(); } catch { /* closed already */ }
    this.onClose?.();
  }
}

/** Two channel-like ends joined in one process, for the tests: what one sends the other receives. */
export class Loopback {
  constructor() { this.other = null; this.onmessage = null; this.onclose = null; this.bufferedAmount = 0; this.sent = 0; }
  send(text) { this.sent++; this.other.onmessage?.({ data: text }); }
  close() { this.other.onclose?.(); this.onclose?.(); }
  static pair() { const a = new Loopback(), b = new Loopback(); a.other = b; b.other = a; return [a, b]; }
}

// ── the frame on the wire ───────────────────────────────────────────────────────────────────────────
/** decodeFrame's object as JSON carries it (the typed array and the maps as arrays). */
export function packFrame(f) {
  return { faces: f.faces, ents: f.ents, loops: f.loops, styles: Array.from(f.styles), speakers: f.speakers,
    brushFrames: [...f.brushFrames], brushAngles: [...f.brushAngles], boxes: f.boxes ?? [] };
}
export function unpackFrame(p, sounds = [], fx = []) {
  return { faces: p.faces, ents: p.ents, sounds, fx, loops: p.loops, styles: Float32Array.from(p.styles), speakers: p.speakers,
    brushFrames: new Map(p.brushFrames), brushAngles: new Map(p.brushAngles), boxes: Array.isArray(p.boxes) ? p.boxes : [] };
}

// ── the host: the guest's commands in, its frames out ───────────────────────────────────────────────
/**
 * SV_DirectConnect's and ClientConnect's password check on a guest's userinfo: a watcher's password against the host's
 * spectator_password (none when it is empty or "none"), a player's against the host's password (none when empty); the reason
 * to refuse it, or null. The host kicks a refused guest with the reason, as the connect was refused with it.
 */
export function connectRefusal(info, { password = '', spectatorPassword = '' } = {}) {
  const given = String(info?.password ?? '');
  if (info?.spectator) {
    const sp = String(spectatorPassword ?? '');
    return sp && sp !== 'none' && given !== sp ? 'Spectator password required or incorrect' : null;
  }
  const pw = String(password ?? '');
  return pw && given !== pw ? 'Password required or incorrect' : null;
}

/** SV_CheckTimeouts and CL_CheckTimeout: whether a link has been silent longer than `seconds` (0: never), by its clock. */
export const silentPast = (link, seconds) => seconds > 0 && link.now() - link.heardAt > seconds * 1000;

export class HostLink {
  constructor(link, { now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) } = {}) {
    this.link = link;
    this.pending = [];      // the guest's commands since the last tic
    this.last = null;       // the last command the tic ran
    this.now = now;
    this.heardAt = now();   // when the guest was last heard (SV_CheckTimeouts: silent past the timeout cvar, it is dropped)
    this.ack = -1;          // the sequence number of the newest command merged into a tic (the guest predicts past it)
    this.wantInv = false;   // the guest has its inventory screen up
    this.info = null;       // the guest's userinfo: { name, hand, spectator, fov, gender, msg, rate, skin, password }, as it last sent it (ClientUserinfoChanged)
    this.onInfo = null;
    this.onSay = null;      // the guest's chat (Cmd_Say_f): the host says it for the guest's client
    this.onConsole = null;  // the guest's console command (Cmd_ForwardToServer): the host runs it for the guest's client
    this.onRcon = null;     // the guest's rcon (CL_Rcon_f): the password it sent and the line, for the host's SV_RemoteCommand_f
    this.onClose = null;
    this.sentFrames = 0;
    this.droppedFrames = 0;
    this.heldFrames = 0;    // SV_RateDrop's surpressCount: the frames held back to the guest's rate
    this.sizes = [];        // the frames sent in the last second as [at, size] (SV_RateDrop's message_size ring, by the clock here)
    this.ping = null;       // the guest's round trip in whole milliseconds, from its last pong (null until one came)
    this.now = now;
    link.onMessage = (m) => {
      if (!m) return;
      this.heardAt = this.now();
      if (m.t === 'cmd' && Array.isArray(m.c)) { this.pending.push(m.c); this.wantInv = !!m.inv; if (Number.isInteger(m.seq)) this.pendingSeq = m.seq; }
      else if (m.t === 'pong' && typeof m.at === 'number') this.ping = Math.max(0, Math.round(this.now() - m.at));
      else if (m.t === 'info') {
        this.info = { name: typeof m.name === 'string' ? m.name.slice(0, 15) : '', hand: [0, 1, 2].includes(m.hand) ? m.hand : 0, spectator: m.spectator ? 1 : 0,
          fov: Number.isFinite(m.fov) ? Math.max(1, Math.min(160, Math.round(m.fov))) : null,   // (the fov userinfo: the guest's own, its frame at it)
          gender: typeof m.gender === 'string' && m.gender ? m.gender.slice(0, 15) : 'male',   // (the gender userinfo: the obituaries' pronouns, the sexed sounds)
          msg: [0, 1, 2, 3].includes(m.msg) ? m.msg : 1,   // (the msg userinfo: the prints below it dropped)
          rate: clampRate(m.rate),   // (the rate userinfo: the bytes a second the frames to this guest keep under, SV_UserinfoChanged's clamp)
          skin: skinOf(m.skin),   // (the skin userinfo: model/skin, kept as ClientUserinfoChanged took it)
          password: typeof m.password === 'string' ? m.password.slice(0, 32) : '' };   // (the password userinfo: the host's password or spectator_password against it)
        this.onInfo?.(this.info);
      }
      else if (m.t === 'say' && typeof m.text === 'string') { const text = m.text.replace(/[\r\n]+/g, ' ').trim().slice(0, 150); if (text) this.onSay?.(text); }
      else if (m.t === 'con' && typeof m.cmd === 'string') { const cmd = m.cmd.trim().slice(0, 32), arg = String(m.arg ?? '').trim().slice(0, 64); if (cmd) this.onConsole?.(cmd, arg); }
      else if (m.t === 'rcon' && typeof m.cmd === 'string') { const line = m.cmd.trim().slice(0, 256); if (line) this.onRcon?.(String(m.password ?? '').slice(0, 32), line); }
    };
    link.onClose = () => this.onClose?.();
  }
  get open() { return this.link.open; }
  /**
   * The guest's usercmd for this tic: the commands that arrived since the last one merged (the turns summed,
   * the buttons any that were pressed, the movement and the run the latest, the last impulse); none arrived,
   * the guest stands, as a client whose packets did not come stood (the guest sends one every animation
   * frame, so only a page that is paused, hidden or in a menu is silent).
   */
  takeCommand() {
    if (!this.pending.length) return [1, 0, 0, 0, 0, 0, 0, this.last ? this.last[7] : 1, 0];
    const c = [1, 0, 0, 0, 0, 0, 0, 1, 0];
    for (const p of this.pending) {
      c[1] = +p[1] || 0; c[2] = +p[2] || 0; c[3] += +p[3] || 0; c[4] += +p[4] || 0;
      c[5] = c[5] || (p[5] ? 1 : 0); c[6] = c[6] || (+p[6] || 0); c[7] = p[7] ? 1 : 0;   // (the upmove as sent: ±cl_upspeed, a crouch's negative kept)
      if (p[8]) c[8] = +p[8];
    }
    this.pending.length = 0;
    if (this.pendingSeq !== undefined) { this.ack = this.pendingSeq; this.pendingSeq = undefined; }
    this.last = c;
    return c;
  }
  /** A map is in: its name and what the guest's page sets up from (the sky, the music, the speakers, the view). */
  sendMap(setup) { this.link.send({ t: 'map', ...setup }); }
  /** A picture screen at a level's end (the guest shows it until the next map). */
  sendPic(file) { this.link.send({ t: 'pic', file }); }
  /** A cinematic at a level's end (the guest plays its own copy until the next map). */
  sendCin(file) { this.link.send({ t: 'cin', file }); }
  /** A print for the guest's console (Com_BeginRedirect's RD_PACKET: what the host's console said to an rcon line, "Bad rcon_password." for a wrong one). */
  sendPrint(text) { this.link.send({ t: 'print', text: String(text ?? '').slice(0, 4000) }); }
  /** SV_Kick_f: the guest is told it was kicked (its page says so), then the channel closes. */
  sendKick(reason = 'kicked') { this.link.send({ t: 'kick', reason: String(reason ?? '').slice(0, 80) }); }
  /** A ping (the host's clock in it): the guest answers with a pong carrying it back, and `ping` is the round trip (the score board's). */
  sendPing() { this.link.send({ t: 'ping', at: this.now() }); }
  /**
   * The guest's frame: its player row, its frame's rows (packed), the tic's sounds and effects (they come with
   * the host's own frame query, the first of the tic), the tic's length, the newest command the tic took (`ack`:
   * the guest predicts from this frame with the commands after it) and, when asked, its inventory rows.
   * Dropped, not queued, when the channel is behind; held (SV_RateDrop) when the frames of the last second sum past
   * the guest's rate userinfo (its bytes a second), counted in `heldFrames` as surpressCount counted them.
   */
  sendFrame(row, frame, { sounds = [], fx = [], dt = 0.05, inv = null } = {}) {
    if (this.link.buffered > BACKLOG) { this.droppedFrames++; return false; }
    const at = this.now();
    while (this.sizes.length && this.sizes[0][0] <= at - 1000) this.sizes.shift();
    if (this.sizes.reduce((n, s) => n + s[1], 0) > (this.info?.rate ?? 500000)) { this.heldFrames++; return false; }
    const size = this.link.send({ t: 'f', row, f: packFrame(frame), sounds, fx, dt, ack: this.ack, ...(inv ? { inv } : {}) });
    this.sizes.push([at, size]);
    this.sentFrames++;
    return true;
  }
  close() { this.link.close(); }
}

// ── the guest: its commands out, the host's frames in ───────────────────────────────────────────────
export class GuestLink {
  constructor(link, { now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) } = {}) {
    this.link = link;
    this.now = now;
    this.heardAt = now();   // when the host was last heard (CL_CheckTimeout: silent past cl_timeout, the guest leaves)
    this.map = null;        // the last map message
    this.row = null;        // the guest's player row of the last frame
    this.frame = null;      // ... and its frame, unpacked
    this.dt = 0.05;
    this.ack = -1;          // the newest command (by sequence number) the last frame's tic took
    this.inv = [];          // the inventory rows the host last sent
    this.fresh = false;     // a frame arrived since take()
    this.frames = 0;
    this.onMap = null;
    this.onPic = null;
    this.onCin = null;
    this.onKick = null;     // the host kicked this guest (SV_Kick_f): the reason, before the channel closes
    this.onPrint = null;    // a print from the host's console (an rcon line's answer, CL_ConnectionlessPacket's "print")
    this.onClose = null;
    link.onMessage = (m) => this.receive(m);
    link.onClose = () => this.onClose?.();
  }
  get open() { return this.link.open; }
  receive(m, size = 0) {
    if (!m || typeof m !== 'object') return;
    this.heardAt = this.now();
    if (this.onNet) this.onNet(String(m.t ?? '?'), size || JSON.stringify(m).length);   // (cl_shownet: each message's kind and size, as CL_ParseServerMessage printed them; a link in one process gives no text, so its size is the JSON's)
    switch (m.t) {
      case 'map': this.map = m; this.frame = null; this.fresh = false; this.onMap?.(m); break;
      case 'f':
        this.row = m.row; this.frame = unpackFrame(m.f, m.sounds ?? [], m.fx ?? []); this.dt = m.dt ?? 0.05; this.ack = Number.isInteger(m.ack) ? m.ack : -1;
        if (m.inv) this.inv = m.inv;
        this.fresh = true; this.frames++;
        break;
      case 'pic': this.onPic?.(m.file); break;
      case 'cin': this.onCin?.(m.file); break;
      case 'kick': this.kicked = String(m.reason ?? 'kicked'); this.onKick?.(this.kicked); break;
      case 'print': if (typeof m.text === 'string') this.onPrint?.(m.text.slice(0, 4000)); break;
      case 'ping': if (typeof m.at === 'number') this.link.send({ t: 'pong', at: m.at }); break;   // (answered at once: the host's clock goes back as it came)
      default: break;
    }
  }
  /** This tic's usercmd (Input.read's array); `inv` asks for the inventory rows with the frames; `seq` numbers it for the ack. */
  sendCommand(cmd, { inv = false, seq } = {}) { this.link.send({ t: 'cmd', c: cmd, inv: !!inv, ...(Number.isInteger(seq) ? { seq } : {}) }); }
  /** The guest's userinfo (the name and the hand of its player setup, whether it only watches, its fov, its rate and skin), at the connect and whenever it changes. */
  sendInfo({ name = '', hand = 0, spectator = 0, fov = null, gender = 'male', msg = 1, rate = null, skin = null, password = '' } = {}) {
    this.link.send({ t: 'info', name: String(name).slice(0, 15), hand, spectator: spectator ? 1 : 0, ...(Number.isFinite(fov) ? { fov } : {}), gender: String(gender ?? 'male').slice(0, 15), msg,
      ...(Number.isFinite(rate) ? { rate } : {}), ...(skin != null ? { skin: String(skin).slice(0, 31) } : {}), password: String(password ?? '').slice(0, 32) });
  }
  /** The guest's chat (`say` at its console): the host prints it for the guest's client. */
  sendSay(text) { this.link.send({ t: 'say', text: String(text ?? '').slice(0, 150) }); }
  /** A game command typed at the guest's console (god, give, kill…): the host runs it for the guest's client, as Cmd_ForwardToServer sent it. */
  sendConsole(cmd, arg = '') { this.link.send({ t: 'con', cmd: String(cmd ?? '').slice(0, 32), arg: String(arg ?? '').slice(0, 64) }); }
  /** CL_Rcon_f: a line for the host's console with the password (the host's Rcon_Validate judges it, its prints come back as a print message). */
  sendRcon(password, line) { this.link.send({ t: 'rcon', password: String(password ?? '').slice(0, 32), cmd: String(line ?? '').slice(0, 256) }); }
  /** The newest frame since the last take, with its row, or null. */
  take() {
    if (!this.fresh) return null;
    this.fresh = false;
    return { row: this.row, frame: this.frame, dt: this.dt, inv: this.inv, ack: this.ack };
  }
  close() { this.link.close(); }
}

// ── signalling by hand: the offer and the answer as texts to pass each other ────────────────────────
const CH = 0x8000;
function toBase64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }
function fromBase64(text) { const s = atob(text); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
async function gzip(text) { return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }
async function gunzip(bytes) { return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }

/** A session description as the text a player passes on: gzipped, base64'd, under a kilobyte. */
export async function packSignal(desc) {
  return SIGNAL_MAGIC + toBase64(await gzip(JSON.stringify({ type: desc.type, sdp: desc.sdp })));
}
/** ... and back; a plain JSON description is taken too. Throws on anything else. */
export async function unpackSignal(text) {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('nothing to connect with');
  const json = t.startsWith(SIGNAL_MAGIC) ? await gunzip(fromBase64(t.slice(SIGNAL_MAGIC.length))) : t;
  const d = JSON.parse(json);
  if (!d || typeof d.sdp !== 'string' || !d.type) throw new Error('that is not an offer or an answer');
  return d;
}

// ── a signalling relay of the player's own (scripts/signal.mjs): the texts under a room code ──────────────
/**
 * The relay's client, over fetch (given, so a test runs it in Node against the server in-process): the host
 * publishes its offer and gets a code, waits for the answer under it; the guest fetches the offer by the code
 * and posts its answer. Every failure is an Error with words for the page.
 */
export class SignalClient {
  constructor(url, fetchFn = globalThis.fetch) {
    this.base = String(url ?? '').trim().replace(/\/+$/, '');
    this.fetchFn = fetchFn;
  }
  async call(method, path, body) {
    let res;
    // (the window's fetch wants the window as `this`: "Illegal invocation" otherwise)
    try { res = await this.fetchFn.call(globalThis, `${this.base}${path}`, { method, body, headers: body ? { 'Content-Type': 'text/plain' } : undefined }); }
    catch (err) { throw new Error(`the relay at ${this.base} did not answer (${err?.message ?? err})`); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 404 ? 'no game under that code' : res.status === 409 ? 'that game was answered already' : `the relay refused (${res.status}${data.error ? `: ${data.error}` : ''})`);
    return data;
  }
  /** The host's: the offer published under a new code, or under `own`, the code it had (a guest's reconnect finds it there). */
  async publish(offer, own = null) {
    const { code } = await this.call('POST', own ? `/rooms/${roomCode(own)}` : '/rooms', offer);
    if (!code) throw new Error('the relay gave no code');
    return code;
  }
  /** The guest's: the offer under a code. */
  async offer(code) { const { offer } = await this.call('GET', `/rooms/${roomCode(code)}`); if (!offer) throw new Error('no game under that code'); return offer; }
  /** The guest's: its answer posted under the code. */
  async answer(code, text) { await this.call('POST', `/rooms/${roomCode(code)}/answer`, text); }
  /** The host's: the answer when it comes, asked for every `everyMs`; null past `timeoutMs` or once `stopped()`. */
  async waitAnswer(code, { everyMs = 1000, timeoutMs = 10 * 60 * 1000, stopped = () => false, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until && !stopped()) {
      const { answer } = await this.call('GET', `/rooms/${roomCode(code)}/answer`);
      if (answer) return answer;
      await sleep(everyMs);
    }
    return null;
  }
  /** The host's: the room is done with (a failure here is nobody's concern). */
  async drop(code) { await this.call('DELETE', `/rooms/${roomCode(code)}`).catch(() => undefined); }
}
/** Whether a text is a room code (four of the relay's letters and digits) rather than an offer. */
export const isRoomCode = (text) => /^[A-Z2-9]{4}$/i.test(String(text ?? '').trim());
const roomCode = (code) => String(code ?? '').trim().toUpperCase();

// ── the ICE servers: a STUN server always, and the one the player set (rtc_ice at the console) ────────────
const STUN = 'stun:stun.l.google.com:19302';
/**
 * The rtc_ice setting parsed: `<url>` or `<url> <user> <pass>`, the url a stun:, stuns:, turn: or turns: one, as
 * RTCIceServer takes it ({ urls, username, credential }); null for an empty setting. Throws on anything else.
 */
export function parseIceServer(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  if (words.length !== 1 && words.length !== 3) throw new Error('rtc_ice takes a url, or a url, a user and a password');
  const [url, username, credential] = words;
  if (!/^(stuns?|turns?):[^\s@]+$/i.test(url)) throw new Error('the url is stun:host[:port], turn:host[:port] or turns:host[:port]');
  if (username && /^stuns?:/i.test(url)) throw new Error('a STUN server takes no user and password');
  return username ? { urls: url, username, credential } : { urls: url };
}
/** What a Peer is made with: the STUN server, and the server the setting names after it. */
export function iceServers(setting) {
  const own = parseIceServer(setting);
  return own ? [{ urls: STUN }, own] : [{ urls: STUN }];
}

/**
 * A peer connection with one data channel, driven by hand: the host makes an offer text, the guest answers
 * it with a text of its own, the host accepts that; `ready` resolves to the Link when the channel opens.
 * The ICE candidates are gathered before a text is made (the texts are passed once), waiting at most
 * `gatherMs` for the STUN server (and the TURN server the setting names, for the networks a STUN cannot cross:
 * two players behind symmetric NATs never meet without a relay); a connection on one machine or one network
 * needs none.
 */
export class Peer {
  constructor({ iceServers: servers = iceServers(''), gatherMs = 3000, RTC = globalThis.RTCPeerConnection } = {}) {
    if (!RTC) throw new Error('WebRTC is not available here');
    this.pc = new RTC({ iceServers: servers });
    this.gatherMs = gatherMs;
    this.link = null;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed') { this.rejectReady?.(new Error(`the connection ${s}`)); this.link?.close(); }
    };
  }
  takeChannel(ch) {
    // (a channel handed over by ondatachannel can be open already and still fire its open event: one Link)
    const opened = () => { if (this.link) return; this.link = new Link(ch); this.resolveReady(this.link); };
    ch.onopen = opened;
    ch.onerror = (e) => this.rejectReady?.(new Error(e?.error?.message ?? 'the channel failed'));
    if (ch.readyState === 'open') opened();
  }
  async gathered() {
    const pc = this.pc;
    if (pc.iceGatheringState === 'complete') return;
    await new Promise((resolve) => {
      const done = () => { pc.removeEventListener('icegatheringstatechange', check); clearTimeout(timer); resolve(); };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(done, this.gatherMs);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }
  /** The host's side: the offer text to send to the guest. */
  async offer() {
    this.takeChannel(this.pc.createDataChannel('q2', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this.gathered();
    return packSignal(this.pc.localDescription);
  }
  /** The guest's side: the answer text to send back, for the host's offer text. */
  async answer(offerText) {
    const offer = await unpackSignal(offerText);
    if (offer.type !== 'offer') throw new Error('that is not an offer');
    this.pc.ondatachannel = (e) => this.takeChannel(e.channel);
    await this.pc.setRemoteDescription(offer);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this.gathered();
    return packSignal(this.pc.localDescription);
  }
  /** The host's side again: the guest's answer text. */
  async accept(answerText) {
    const answer = await unpackSignal(answerText);
    if (answer.type !== 'answer') throw new Error('that is not an answer');
    await this.pc.setRemoteDescription(answer);
  }
  close() { this.link?.close(); try { this.pc.close(); } catch { /* closed */ } }
}
