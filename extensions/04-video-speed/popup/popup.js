const $ = (id) => document.getElementById(id);
const DEFAULTS = {
  speed: 1, step: 0.1, seek: 10, favorite: 1.75, remember: true,
  keys: { slower: "s", faster: "d", reset: "r", favorite: "g", back: "z", forward: "x", hide: "v" },
};
const LABELS = { slower: "Slower", faster: "Faster", reset: "Reset to 1× / back to favorite", favorite: "Favorite speed", back: "Rewind", forward: "Skip forward", hide: "Show / hide indicator" };

(async () => {
  const s = await chrome.storage.sync.get(DEFAULTS);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const showSpeed = (v) => { $("cur").textContent = (+v).toFixed(2) + "×"; $("range").value = v; };
  async function setSpeed(v) {
    v = Math.min(16, Math.max(0.07, +v));
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: "set", speed: v });
      if (r) { showSpeed(r.speed); return; }
    } catch {}
    await chrome.storage.sync.set({ speed: v }); // no video in this tab: just remember it
    showSpeed(v);
  }

  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: "get" });
    showSpeed(r ? r.speed : s.speed);
    $("note").textContent = r ? "Video found in this tab" : "No video in this tab – this sets your default speed";
  } catch {
    showSpeed(s.speed);
    $("note").textContent = "This page can't be controlled (reload it, or it is a browser page)";
  }

  $("range").oninput = (e) => setSpeed(e.target.value);
  for (const p of [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]) {
    const b = document.createElement("button");
    b.textContent = p + "×";
    b.onclick = () => setSpeed(p);
    $("presets").append(b);
  }

  for (const [action, label] of Object.entries(LABELS)) {
    const l = document.createElement("span");
    l.textContent = label;
    const i = document.createElement("input");
    i.type = "text";
    i.value = s.keys[action] || "";
    i.readOnly = true;
    i.onkeydown = async (e) => {
      e.preventDefault();
      if (e.key.length !== 1) return;          // single printable keys only
      const k = e.key.toLowerCase();
      const keys = (await chrome.storage.sync.get(DEFAULTS)).keys;
      for (const a in keys) if (keys[a] === k) keys[a] = "";  // a key can do only one thing
      keys[action] = k;
      await chrome.storage.sync.set({ keys });
      for (const el of $("keys").querySelectorAll("input")) el.value = keys[el.dataset.a] || "";
    };
    i.dataset.a = action;
    $("keys").append(l, i);
  }

  for (const id of ["step", "seek", "favorite"]) {
    $(id).value = s[id];
    $(id).onchange = (e) => chrome.storage.sync.set({ [id]: +e.target.value || DEFAULTS[id] });
  }
  $("remember").checked = s.remember;
  $("remember").onchange = (e) => chrome.storage.sync.set({ remember: e.target.checked });
})();
