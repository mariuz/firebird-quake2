// demostore.js – what the page keeps across reloads in IndexedDB, as the saves are kept in localStorage: the
// recordings (a .dm2 by name: hundreds of kilobytes to a few megabytes, past localStorage's quota, and
// IndexedDB takes a Uint8Array as it is) in the `demos` store, and the player's files in the `files` store:
// the pak picked from the file input (`pak`: its name and bytes, loaded at the next start in place of the
// demo's download) and the music tracks of a picked folder as they play (`music/trackNN`: the file's name and
// bytes, played at the next start when no folder is picked). A recording made here (`record` at the console)
// or opened from a file goes in; the Demo select lists them at the next load; `deldemo <name>` drops one.
//
// Nothing here touches the DOM; the page gives it the window's indexedDB, a test a fake with the same
// shape, and a browser without it (a file: URL, a private window that refuses storage) gets null from open()
// and what was kept lasts the page.

const DB = 'firebird-quake2';
const VERSION = 2;   // 1: the demos; 2: the files too
const STORES = ['demos', 'files'];

/** A request's result as a promise. */
const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed')); });

/** One object store of the database: the keys kept, a value by key, put, remove. */
export class KeptStore {
  constructor(store, idb = globalThis.indexedDB) {
    this.store = store;
    this.idb = idb ?? null;
    this.db = null;
  }

  /** The database, opened once; null where there is none. */
  async open() {
    if (this.db) return this.db;
    if (!this.idb) return null;
    try {
      const req = this.idb.open(DB, VERSION);
      req.onupgradeneeded = () => { const db = req.result; for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); };
      this.db = await done(req);
      this.db.onversionchange = () => { this.db?.close(); this.db = null; };
      return this.db;
    } catch (err) {
      console.warn('demostore:', err?.message ?? err);
      this.idb = null;
      return null;
    }
  }

  async tx(mode, run) {
    const db = await this.open();
    if (!db) return null;
    const t = db.transaction(this.store, mode);
    const result = await done(run(t.objectStore(this.store)));
    await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed')); t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted')); });
    return result;
  }

  /** The keys kept, in order. */
  async list() { return ((await this.tx('readonly', (s) => s.getAllKeys())) ?? []).map(String).sort(); }
  /** What is kept under a key, or null. */
  async get(key) { return (await this.tx('readonly', (s) => s.get(key))) ?? null; }
  /** Keep a value (a new one under the same key replaces it). */
  async put(key, value) { await this.tx('readwrite', (s) => s.put(value, key)); }
  /** Drop one. */
  async remove(key) { await this.tx('readwrite', (s) => s.delete(key)); }
}

/** The recordings: a .dm2's bytes by name. */
export class DemoStore extends KeptStore {
  constructor(idb) { super('demos', idb); }
  /** A recording's bytes, or null. */
  async get(name) { const v = await super.get(name); return v instanceof Uint8Array ? v : v ? new Uint8Array(v) : null; }
}

/** The player's files: `pak` and `music/trackNN`, each { name, bytes }. */
export class FileStore extends KeptStore {
  constructor(idb) { super('files', idb); }
  /** A file kept, as { name, bytes: Uint8Array }, or null. */
  async get(key) { const v = await super.get(key); return v && v.bytes ? { name: String(v.name ?? key), bytes: v.bytes instanceof Uint8Array ? v.bytes : new Uint8Array(v.bytes) } : null; }
}
