const favicon = (url) => {
  const u = new URL(chrome.runtime.getURL("/_favicon/"));
  u.searchParams.set("pageUrl", url);
  u.searchParams.set("size", "16");
  return u.toString();
};

async function load() { return (await chrome.storage.local.get({ sessions: [] })).sessions; }
async function store(sessions) { await chrome.storage.local.set({ sessions: sessions.filter((g) => g.tabs.length) }); }

async function render() {
  const sessions = await load();
  const root = document.getElementById("groups");
  root.innerHTML = "";
  document.getElementById("total").textContent = `${sessions.reduce((n, g) => n + g.tabs.length, 0)} tabs`;
  if (!sessions.length) root.innerHTML = '<p class="muted">Nothing saved yet. Use “Save &amp; close all tabs” in the popup.</p>';

  for (const g of sessions) {
    const box = document.createElement("div");
    box.className = "card group";
    const head = document.createElement("div");
    head.className = "row";
    const title = document.createElement("b");
    title.textContent = `${g.tabs.length} tabs · ${new Date(g.date).toLocaleString()}`;
    const btns = document.createElement("div");
    const restore = document.createElement("button");
    restore.textContent = "Restore all";
    restore.onclick = async () => {
      for (const t of g.tabs) chrome.tabs.create({ url: t.url, active: false });
      await store((await load()).filter((x) => x.id !== g.id));
      render();
    };
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "Delete";
    del.onclick = async () => {
      if (!confirm("Delete this group of saved tabs?")) return;
      await store((await load()).filter((x) => x.id !== g.id));
      render();
    };
    btns.append(restore, " ", del);
    head.append(title, btns);
    const ul = document.createElement("ul");
    ul.className = "list";
    g.tabs.forEach((t, i) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = t.url;
      const img = document.createElement("img");
      img.src = favicon(t.url);
      const span = document.createElement("span");
      span.textContent = t.title;
      a.append(img, span);
      a.onclick = async (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: t.url, active: false });
        const all = await load();
        const grp = all.find((x) => x.id === g.id);
        grp.tabs.splice(i, 1);
        await store(all);
        render();
      };
      const x = document.createElement("button");
      x.className = "x";
      x.title = "Remove";
      x.textContent = "✕";
      x.onclick = async () => {
        const all = await load();
        all.find((y) => y.id === g.id).tabs.splice(i, 1);
        await store(all);
        render();
      };
      li.append(a, x);
      ul.append(li);
    });
    box.append(head, ul);
    root.append(box);
  }
}
render();
chrome.storage.onChanged.addListener((c) => { if (c.sessions) render(); });
