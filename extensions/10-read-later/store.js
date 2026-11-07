// storage.local: { items: { "<url>": { url, title, added, read, note } } }
const cleanUrl = (u) => { try { const x = new URL(u); x.hash = ""; return x.toString(); } catch { return u; } };
const savable = (u) => /^(https?|file):/.test(u || "");
const Store = {
  async all() { return (await chrome.storage.local.get({ items: {} })).items; },
  async get(url) { return (await this.all())[cleanUrl(url)]; },
  async put(item) {
    const items = await this.all();
    const key = cleanUrl(item.url);
    const merged = { read: false, note: "", saved: false, added: Date.now(), ...items[key], ...item, url: key };
    if (!merged.saved && !merged.note.trim()) delete items[key]; // nothing left to keep
    else items[key] = merged;
    await chrome.storage.local.set({ items });
    return items[key];
  },
  async remove(url) {
    const items = await this.all();
    delete items[cleanUrl(url)];
    await chrome.storage.local.set({ items });
  },
};
