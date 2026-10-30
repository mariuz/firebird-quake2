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
// the frame's row (CL_PredictMovement), so its own move shows at once and not a round trip late.
//
// The wire is JSON over a data channel, in chunks a channel is sure to take (16 KB); a frame of demo1 is
// 10–30 KB, one or two chunks, twenty times a second. Signalling is by hand: Pages is static, so the offer
// and the answer are texts the players pass each other (gzipped and base64'd, under a kilobyte each), with
// the ICE candidates gathered before the text is made. HostLink and GuestLink know nothing of WebRTC: a
// test runs them over Loopback.pair() in one process.

export const CHUNK = 16000;           // characters a data channel message is kept under
export const BACKLOG = 256 * 1024;    // bytes queued on the channel before frames are dropped (a slow link)
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
  send(obj) {
    if (!this.open) return;
    const text = JSON.stringify(obj);
    // (a channel closing under a send throws before its close event comes: the link is closed here)
    try {
      if (text.length <= CHUNK) { this.ch.send(text); return; }
      const n = Math.ceil(text.length / CHUNK);
      for (let i = 0; i < n; i++) this.ch.send(`#${n}:${i}:${text.slice(i * CHUNK, (i + 1) * CHUNK)}`);
    } catch { this.close(); }
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
    this.onMessage?.(msg);
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
    brushFrames: [...f.brushFrames], brushAngles: [...f.brushAngles] };
}
export function unpackFrame(p, sounds = [], fx = []) {
  return { faces: p.faces, ents: p.ents, sounds, fx, loops: p.loops, styles: Float32Array.from(p.styles), speakers: p.speakers,
    brushFrames: new Map(p.brushFrames), brushAngles: new Map(p.brushAngles) };
}

// ── the host: the guest's commands in, its frames out ───────────────────────────────────────────────
export class HostLink {
  constructor(link) {
    this.link = link;
    this.pending = [];      // the guest's commands since the last tic
    this.last = null;       // the last command the tic ran
    this.ack = -1;          // the sequence number of the newest command merged into a tic (the guest predicts past it)
    this.wantInv = false;   // the guest has its inventory screen up
    this.info = null;       // the guest's userinfo: { name, hand }, as it last sent it (ClientUserinfoChanged)
    this.onInfo = null;
    this.onClose = null;
    this.sentFrames = 0;
    this.droppedFrames = 0;
    link.onMessage = (m) => {
      if (!m) return;
      if (m.t === 'cmd' && Array.isArray(m.c)) { this.pending.push(m.c); this.wantInv = !!m.inv; if (Number.isInteger(m.seq)) this.pendingSeq = m.seq; }
      else if (m.t === 'info') { this.info = { name: typeof m.name === 'string' ? m.name.slice(0, 15) : '', hand: [0, 1, 2].includes(m.hand) ? m.hand : 0 }; this.onInfo?.(this.info); }
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
      c[5] = c[5] || (p[5] ? 1 : 0); c[6] = c[6] || (p[6] ? 1 : 0); c[7] = p[7] ? 1 : 0;
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
  /**
   * The guest's frame: its player row, its frame's rows (packed), the tic's sounds and effects (they come with
   * the host's own frame query, the first of the tic), the tic's length, the newest command the tic took (`ack`:
   * the guest predicts from this frame with the commands after it) and, when asked, its inventory rows.
   * Dropped, not queued, when the channel is behind.
   */
  sendFrame(row, frame, { sounds = [], fx = [], dt = 0.05, inv = null } = {}) {
    if (this.link.buffered > BACKLOG) { this.droppedFrames++; return false; }
    this.link.send({ t: 'f', row, f: packFrame(frame), sounds, fx, dt, ack: this.ack, ...(inv ? { inv } : {}) });
    this.sentFrames++;
    return true;
  }
  close() { this.link.close(); }
}

// ── the guest: its commands out, the host's frames in ───────────────────────────────────────────────
export class GuestLink {
  constructor(link) {
    this.link = link;
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
    this.onClose = null;
    link.onMessage = (m) => this.receive(m);
    link.onClose = () => this.onClose?.();
  }
  get open() { return this.link.open; }
  receive(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'map': this.map = m; this.frame = null; this.fresh = false; this.onMap?.(m); break;
      case 'f':
        this.row = m.row; this.frame = unpackFrame(m.f, m.sounds ?? [], m.fx ?? []); this.dt = m.dt ?? 0.05; this.ack = Number.isInteger(m.ack) ? m.ack : -1;
        if (m.inv) this.inv = m.inv;
        this.fresh = true; this.frames++;
        break;
      case 'pic': this.onPic?.(m.file); break;
      case 'cin': this.onCin?.(m.file); break;
      default: break;
    }
  }
  /** This tic's usercmd (Input.read's array); `inv` asks for the inventory rows with the frames; `seq` numbers it for the ack. */
  sendCommand(cmd, { inv = false, seq } = {}) { this.link.send({ t: 'cmd', c: cmd, inv: !!inv, ...(Number.isInteger(seq) ? { seq } : {}) }); }
  /** The guest's userinfo (the name and the hand of its player setup), at the connect and whenever it changes. */
  sendInfo({ name = '', hand = 0 } = {}) { this.link.send({ t: 'info', name: String(name).slice(0, 15), hand }); }
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

/**
 * A peer connection with one data channel, driven by hand: the host makes an offer text, the guest answers
 * it with a text of its own, the host accepts that; `ready` resolves to the Link when the channel opens.
 * The ICE candidates are gathered before a text is made (the texts are passed once), waiting at most
 * `gatherMs` for the STUN server; a connection on one machine or one network needs none.
 */
export class Peer {
  constructor({ iceServers = [{ urls: 'stun:stun.l.google.com:19302' }], gatherMs = 3000, RTC = globalThis.RTCPeerConnection } = {}) {
    if (!RTC) throw new Error('WebRTC is not available here');
    this.pc = new RTC({ iceServers });
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
