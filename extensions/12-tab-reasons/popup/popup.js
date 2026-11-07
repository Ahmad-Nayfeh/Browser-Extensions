const $ = (id) => document.getElementById(id);
const DEFAULTS = { ask: "many", many: 6, remindMin: 15 };
const favicon = (url) => { const u = new URL(chrome.runtime.getURL("/_favicon/")); u.searchParams.set("pageUrl", url); u.searchParams.set("size", "16"); return u.toString(); };

(async () => {
  const [cur] = await chrome.tabs.query({ active: true, currentWindow: true });

  async function render() {
    const { reasons = {} } = await chrome.storage.local.get("reasons");
    const tabs = await chrome.tabs.query({});
    if (document.activeElement !== $("reason")) $("reason").value = reasons[cur.id] ? reasons[cur.id].text : "";
    const withReason = tabs.filter((t) => reasons[t.id]);
    $("none").textContent = `${tabs.length - withReason.length} tabs without a reason`;
    const list = $("list");
    list.innerHTML = withReason.length ? "" : '<p class="muted small">None yet.</p>';
    for (const t of withReason.sort((a, b) => reasons[a.id].at - reasons[b.id].at)) {
      const row = document.createElement("div");
      row.className = "tab";
      const img = document.createElement("img"); img.src = favicon(t.url);
      const mid = document.createElement("div");
      const r = document.createElement("div"); r.className = "r"; r.textContent = reasons[t.id].text;
      const ti = document.createElement("div"); ti.className = "ti"; ti.textContent = t.title;
      mid.append(r, ti);
      const x = document.createElement("button"); x.textContent = "✓ close"; x.title = "Done – close this tab";
      x.onclick = (e) => { e.stopPropagation(); chrome.tabs.remove(t.id); setTimeout(render, 200); };
      row.onclick = () => { chrome.tabs.update(t.id, { active: true }); chrome.windows.update(t.windowId, { focused: true }); };
      row.append(img, mid, x);
      list.append(row);
    }
  }

  const save = async () => { await chrome.runtime.sendMessage({ type: "setReason", tabId: cur.id, text: $("reason").value }); render(); };
  $("save").onclick = save;
  $("reason").onkeydown = (e) => { if (e.key === "Enter") save(); };
  if (!/^https?:/.test(cur.url || "")) { $("reason").placeholder = "(works on normal web pages)"; }

  const s = await chrome.storage.sync.get(DEFAULTS);
  for (const k of ["ask", "many", "remindMin"]) {
    $(k).value = s[k];
    $(k).onchange = (e) => { chrome.storage.sync.set({ [k]: k === "ask" ? e.target.value : Math.max(1, +e.target.value || DEFAULTS[k]) }); $("manyRow").hidden = $("ask").value !== "many"; };
  }
  $("manyRow").hidden = s.ask !== "many";
  render();
  $("reason").focus();
})();
