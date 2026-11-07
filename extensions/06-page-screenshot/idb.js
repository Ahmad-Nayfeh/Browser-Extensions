// Tiny IndexedDB helper – screenshots can be tens of MB, too big for chrome.storage.
const ShotDB = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("snap", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("shots");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction("shots", mode);
      const req = fn(tx.objectStore("shots"));
      tx.oncomplete = () => { db.close(); res(req && req.result); };
      tx.onerror = () => { db.close(); rej(tx.error); };
    });
  },
  put(id, value) { return this.run("readwrite", (s) => s.put(value, id)); },
  get(id) { return this.run("readonly", (s) => s.get(id)); },
  del(id) { return this.run("readwrite", (s) => s.delete(id)); },
  clear() { return this.run("readwrite", (s) => s.clear()); },
};
