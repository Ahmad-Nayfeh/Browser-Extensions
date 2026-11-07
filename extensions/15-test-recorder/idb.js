// Recorded events go to IndexedDB (on disk), one by one, as they happen.
const TraceDB = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open("trace", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("events", { autoIncrement: true });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction("events", mode);
      const req = fn(t.objectStore("events"));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  },
  add(ev) { return this.tx("readwrite", (s) => s.add(ev)); },
  all() { return this.tx("readonly", (s) => s.getAll()); },
  clear() { return this.tx("readwrite", (s) => s.clear()); },
};
