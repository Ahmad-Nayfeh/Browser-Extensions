const $ = (id) => document.getElementById(id);
const DEF = { on: true, sites: {}, brightness: 100, contrast: 100, sepia: 0, skipDark: true };

(async () => {
  const s = await chrome.storage.sync.get(DEF);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try { const u = new URL(tab.url); if (/^(https?|file):$/.test(u.protocol)) host = u.hostname.replace(/^www\./, ""); } catch {}

  $("on").checked = s.on;
  $("on").onchange = (e) => chrome.storage.sync.set({ on: e.target.checked });

  $("host").textContent = host || "This page can't be changed";
  const btns = [...document.querySelectorAll("#siteBtns button")];
  const mark = (v) => btns.forEach((b) => b.classList.toggle("primary", b.dataset.v === (v || "")));
  mark(s.sites[host]);
  btns.forEach((b) => {
    b.disabled = !host;
    b.onclick = async () => {
      const { sites } = await chrome.storage.sync.get({ sites: {} });
      if (b.dataset.v) sites[host] = b.dataset.v; else delete sites[host];
      await chrome.storage.sync.set({ sites });
      mark(b.dataset.v);
    };
  });

  for (const id of ["brightness", "contrast", "sepia"]) {
    $(id).value = s[id];
    let t = null; // storage.sync allows ~2 writes/second – don't write on every pixel of the drag
    $(id).oninput = (e) => { clearTimeout(t); t = setTimeout(() => chrome.storage.sync.set({ [id]: +e.target.value }), 250); };
  }
  $("skipDark").checked = s.skipDark;
  $("skipDark").onchange = (e) => chrome.storage.sync.set({ skipDark: e.target.checked });
})();
