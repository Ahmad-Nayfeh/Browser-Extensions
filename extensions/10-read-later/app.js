const $ = (id) => document.getElementById(id);
const full = new URLSearchParams(location.search).has("full");
let tab = "unread";
let current = null; // the browser tab this popup belongs to

if (full) {
  document.body.className = "page stack";
  $("here").hidden = true;
  $("full").hidden = true;
}

const favicon = (url) => {
  const u = new URL(chrome.runtime.getURL("/_favicon/"));
  u.searchParams.set("pageUrl", url);
  u.searchParams.set("size", "16");
  return u.toString();
};
const ago = (t) => {
  const d = Math.round((Date.now() - t) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

async function renderHere() {
  if (full) return;
  [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!current || !savable(current.url)) {
    $("hereTitle").textContent = "This page can't be saved";
    $("save").disabled = $("note").disabled = true;
    return;
  }
  const it = await Store.get(current.url);
  $("hereTitle").textContent = current.title || current.url;
  $("save").textContent = it && it.saved ? "Saved ✓ (remove)" : "Save for later";
  $("save").classList.toggle("primary", !(it && it.saved));
  if (document.activeElement !== $("note")) $("note").value = (it && it.note) || "";
}

async function renderList() {
  const items = Object.values(await Store.all());
  const q = $("q").value.trim().toLowerCase();
  const filter = {
    unread: (i) => i.saved && !i.read,
    read: (i) => i.saved && i.read,
    notes: (i) => i.note && i.note.trim(),
  }[tab];
  const shown = items
    .filter(filter)
    .filter((i) => !q || `${i.title} ${i.url} ${i.note}`.toLowerCase().includes(q))
    .sort((a, b) => b.added - a.added);
  $("count").textContent = `${items.filter((i) => i.saved && !i.read).length} to read`;

  const list = $("list");
  list.innerHTML = "";
  if (!shown.length) list.innerHTML = `<p class="muted">${q ? "Nothing matches." : tab === "notes" ? "No notes yet." : "Nothing here yet."}</p>`;
  for (const i of shown) {
    const row = document.createElement("div");
    row.className = "item";
    const img = document.createElement("img");
    img.src = favicon(i.url);
    const mid = document.createElement("div");
    const a = document.createElement("a");
    a.href = i.url;
    a.textContent = i.title || i.url;
    a.onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: i.url }); };
    const info = document.createElement("div");
    info.className = "muted small";
    let host = i.url;
    try { host = new URL(i.url).hostname.replace(/^www\./, ""); } catch {}
    info.textContent = `${host} · ${ago(i.added)}`;
    mid.append(a, info);
    if (i.note && i.note.trim()) {
      const n = document.createElement("div");
      n.className = "note small";
      n.textContent = i.note;
      mid.append(n);
    }
    const act = document.createElement("div");
    act.className = "act";
    if (i.saved) {
      const r = document.createElement("button");
      r.title = i.read ? "Mark as unread" : "Mark as read";
      r.textContent = i.read ? "↺" : "✓";
      r.onclick = () => Store.put({ url: i.url, read: !i.read });
      act.append(r);
    }
    const x = document.createElement("button");
    x.title = tab === "notes" ? "Delete note" : "Remove from list";
    x.textContent = "✕";
    x.onclick = () => (tab === "notes" ? Store.put({ url: i.url, note: "" }) : Store.put({ url: i.url, saved: false }));
    act.append(x);
    row.append(img, mid, act);
    list.append(row);
  }
}

const render = () => Promise.all([renderHere(), renderList()]);

$("save").onclick = async () => {
  const it = await Store.get(current.url);
  await Store.put({ url: current.url, title: current.title, saved: !(it && it.saved), read: false });
};
let t = null;
$("note").oninput = () => {
  clearTimeout(t);
  t = setTimeout(() => Store.put({ url: current.url, title: current.title, note: $("note").value }), 400);
};
document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => {
  tab = b.dataset.tab;
  document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
  renderList();
}));
$("q").oninput = renderList;
$("full").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("app.html?full") });
$("export").onclick = async () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(await Store.all(), null, 2)], { type: "application/json" }));
  a.download = `later-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
};
$("import").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    const items = await Store.all();
    await chrome.storage.local.set({ items: { ...data, ...items } }); // existing entries win
  } catch (err) { alert("Import failed: " + err.message); }
};
chrome.storage.onChanged.addListener((c) => { if (c.items) render(); });
render();
