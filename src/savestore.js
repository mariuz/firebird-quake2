// savestore.js – a saved game as the string localStorage keeps: a header line, then the JSON
// gzipped and base64'd.
//
// localStorage gives an origin about 5 MB, counted in UTF-16 code units, and a demo3 save that
// carries two levels left in the unit is 495 KB of JSON: fifteen slots, the autosave and the
// quick slot would not fit. Gzipped it is 46 KB, 61 KB in base64. The header line keeps what the
// load menu shows (the comment, the map) readable without inflating the rest. A plain JSON save
// from before this format (it starts with `{`) still reads.

export const MAGIC = 'q2gz1';

const CHUNK = 0x8000;
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(s);
}
function fromBase64(text) {
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** The save as the string to store. */
export async function packSave(save) {
  const json = JSON.stringify(save);
  const header = { version: save.version, map: save.map, comment: save.comment ?? null, when: save.when ?? null, bytes: json.length };
  return `${MAGIC}\n${JSON.stringify(header)}\n${toBase64(await gzip(json))}`;
}

/** What the slot list needs, without inflating the save: { version, map, comment, when, bytes }, or null. */
export function saveHeader(text) {
  if (!text) return null;
  if (text.startsWith(MAGIC + '\n')) return JSON.parse(text.slice(MAGIC.length + 1, text.indexOf('\n', MAGIC.length + 1)));
  const s = JSON.parse(text);   // a plain JSON save from before
  return { version: s.version, map: s.map, comment: s.comment ?? null, when: s.when ?? null, bytes: text.length };
}

/** The save back from its stored string (null for nothing stored). */
export async function unpackSave(text) {
  if (!text) return null;
  if (!text.startsWith(MAGIC + '\n')) return JSON.parse(text);
  const body = text.indexOf('\n', MAGIC.length + 1) + 1;
  return JSON.parse(await gunzip(fromBase64(text.slice(body))));
}
