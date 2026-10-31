// signal.mjs – a signalling relay of the player's own, for the network game: the host's offer and the guest's
// answer go through it under a four-letter room code instead of being passed as texts (Pages is static, so
// the page has no relay of its own). A room is the offer, the answer once it comes and when it was made;
// rooms older than ten minutes are swept. Nothing is kept on disk. The page reaches it from any origin.
//
//   npm run signal                     (PORT=8787; then `rtc_signal http://<this machine>:8787` at the console of every page)
//
//   POST   /rooms              the offer as the body → { code }
//   POST   /rooms/<code>       the offer under a code of the host's own (its last one: a guest's reconnect finds it) → { code }
//   GET    /rooms/<code>       → { offer, answer }
//   POST   /rooms/<code>/answer   the answer as the body → { ok } (409 once answered)
//   GET    /rooms/<code>/answer   → { answer } (null until it comes)
//   DELETE /rooms/<code>       → { ok }
//
// `createSignalServer` is exported so the network test runs it in-process on a port of its own.

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // (no 0/O, 1/I: a code is said aloud)
export const CODE_LENGTH = 4;
const TTL = 10 * 60 * 1000;
const MAX_TEXT = 16384;   // (an offer or an answer is under a kilobyte)

export function createSignalServer({ ttlMs = TTL, now = Date.now } = {}) {
  const rooms = new Map();   // code → { offer, answer, at }
  const sweep = () => { for (const [c, r] of rooms) if (now() - r.at > ttlMs) rooms.delete(c); };
  const newCode = () => { for (;;) { let c = ''; for (const b of randomBytes(CODE_LENGTH)) c += ALPHABET[b % ALPHABET.length]; if (!rooms.has(c)) return c; } };
  const server = http.createServer(async (req, res) => {
    // (any origin; Access-Control-Allow-Private-Network for Chrome's private network access, a public page reaching a relay
    // on the LAN. A page served over https reaches an http relay only at localhost: elsewhere the relay goes behind https.)
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true', 'Cache-Control': 'no-store' };
    const reply = (status, body) => { res.writeHead(status, headers); res.end(body === undefined ? '' : JSON.stringify(body)); };
    if (req.method === 'OPTIONS') return reply(204);
    sweep();
    const url = new URL(req.url, 'http://localhost');
    const m = /^\/rooms(?:\/([A-Za-z0-9]+))?(?:\/(answer))?\/?$/.exec(url.pathname);
    if (!m) return reply(404, { error: 'not found' });
    const code = m[1]?.toUpperCase(), part = m[2];
    const body = async () => { let t = ''; for await (const chunk of req) { t += chunk; if (t.length > MAX_TEXT) throw new Error('too long'); } return t.trim(); };
    try {
      if (req.method === 'POST' && !code) {
        const offer = await body();
        if (!offer) return reply(400, { error: 'no offer' });
        const c = newCode();
        rooms.set(c, { offer, answer: null, at: now() });
        return reply(200, { code: c });
      }
      if (req.method === 'POST' && code && !part) {
        // the host's own code (the one it had): the room made anew under it, an answer there before forgotten
        if (code.length !== CODE_LENGTH || [...code].some((ch) => !ALPHABET.includes(ch))) return reply(400, { error: 'not a code' });
        const offer = await body();
        if (!offer) return reply(400, { error: 'no offer' });
        rooms.set(code, { offer, answer: null, at: now() });
        return reply(200, { code });
      }
      const room = code ? rooms.get(code) : null;
      if (!room) return reply(404, { error: 'no such room' });
      if (req.method === 'GET') return reply(200, part ? { answer: room.answer } : { offer: room.offer, answer: room.answer });
      if (req.method === 'POST' && part) {
        if (room.answer) return reply(409, { error: 'answered already' });
        const answer = await body();
        if (!answer) return reply(400, { error: 'no answer' });
        room.answer = answer;
        return reply(200, { ok: true });
      }
      if (req.method === 'DELETE' && !part) { rooms.delete(code); return reply(200, { ok: true }); }
      return reply(405, { error: 'method not allowed' });
    } catch (err) { return reply(400, { error: err.message }); }
  });
  server.rooms = rooms;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787);
  createSignalServer().listen(port, () => console.log(`signalling relay on http://localhost:${port}/ (rtc_signal http://<this machine>:${port} at the console of every page)`));
}
