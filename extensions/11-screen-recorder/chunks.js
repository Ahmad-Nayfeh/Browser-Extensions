// Recording pieces are written to IndexedDB (on disk) every second, so a long
// recording doesn't fill your RAM and survives an accidental tab close.
const Chunks = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open("reel", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("chunks", { autoIncrement: true }); r.result.createObjectStore("meta"); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  },
  add(blob) { return this.tx("chunks", "readwrite", (s) => s.add(blob)); },
  all() { return this.tx("chunks", "readonly", (s) => s.getAll()); },
  async clear() { await this.tx("chunks", "readwrite", (s) => s.clear()); await this.tx("meta", "readwrite", (s) => s.clear()); },
  setMeta(v) { return this.tx("meta", "readwrite", (s) => s.put(v, "last")); },
  getMeta() { return this.tx("meta", "readonly", (s) => s.get("last")); },
};
