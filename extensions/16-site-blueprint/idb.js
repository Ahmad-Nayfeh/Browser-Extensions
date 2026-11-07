// The report and screenshot can be many MB – IndexedDB (on disk) holds them.
const BlueprintDB = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("blueprint", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("reports");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction("reports", mode);
      const req = fn(tx.objectStore("reports"));
      tx.oncomplete = () => { db.close(); res(req && req.result); };
      tx.onerror = () => { db.close(); rej(tx.error); };
    });
  },
  put(id, v) { return this.run("readwrite", (s) => s.put(v, id)); },
  get(id) { return this.run("readonly", (s) => s.get(id)); },
  clear() { return this.run("readwrite", (s) => s.clear()); },
};
