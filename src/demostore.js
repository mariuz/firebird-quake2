// demostore.js – the recordings kept across reloads: a .dm2 by name in IndexedDB, as the saves are kept in
// localStorage (a recording is hundreds of kilobytes to a few megabytes, past localStorage's quota, and
// IndexedDB takes a Uint8Array as it is). A recording made here (`record` at the console) or opened from a
// file goes in; the Demo select lists them at the next load; `deldemo <name>` drops one.
//
// Nothing here touches the DOM; the page gives it the window's indexedDB, a test a fake with the same
// shape, and a browser without it (a file: URL, a private window that refuses storage) gets null from open()
// and the recordings last the page.

const DB = 'firebird-quake2';
const STORE = 'demos';

/** A request's result as a promise. */
const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed')); });

export class DemoStore {
  constructor(idb = globalThis.indexedDB) {
    this.idb = idb ?? null;
    this.db = null;
  }

  /** The database, opened once; null where there is none. */
  async open() {
    if (this.db) return this.db;
    if (!this.idb) return null;
    try {
      const req = this.idb.open(DB, 1);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
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
    const t = db.transaction(STORE, mode);
    const result = await done(run(t.objectStore(STORE)));
    await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed')); t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted')); });
    return result;
  }

  /** The names kept, in order. */
  async list() { return ((await this.tx('readonly', (s) => s.getAllKeys())) ?? []).map(String).sort(); }
  /** A recording's bytes, or null. */
  async get(name) { const v = await this.tx('readonly', (s) => s.get(name)); return v instanceof Uint8Array ? v : v ? new Uint8Array(v) : null; }
  /** Keep a recording (a new one under the same name replaces it). */
  async put(name, bytes) { await this.tx('readwrite', (s) => s.put(bytes, name)); }
  /** Drop one. */
  async remove(name) { await this.tx('readwrite', (s) => s.delete(name)); }
}
