const $ = (id) => document.getElementById(id);

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = hostKey(tab.url);
  $("all").onclick = () => chrome.runtime.openOptionsPage();
  if (!host) {
    $("host").textContent = "This page can't be styled";
    $("css").disabled = $("on").disabled = true;
    return;
  }
  $("host").textContent = host;
  const state = await loadStyles();
  const mine = state.styles[host] || { css: "", on: true };
  $("css").value = mine.css;
  $("on").checked = mine.on;

  let applied = cssFor(host, state); // what the page got when it loaded
  let timer = null;

  async function update() {
    const s = await loadStyles();
    s.styles[host] = { css: $("css").value, on: $("on").checked };
    if (!s.styles[host].css.trim()) delete s.styles[host];
    await chrome.storage.local.set({ styles: s.styles });
    const next = cssFor(host, s);
    try {
      if (applied) await chrome.scripting.removeCSS({ target: { tabId: tab.id }, css: applied, origin: "USER" });
      if (next) await chrome.scripting.insertCSS({ target: { tabId: tab.id }, css: next, origin: "USER" });
      applied = next;
      $("status").textContent = "Saved ✓";
    } catch (e) {
      $("status").textContent = "Saved – reload the page to see it (" + e.message + ")";
    }
  }
  $("css").oninput = () => { clearTimeout(timer); timer = setTimeout(update, 300); };
  $("on").onchange = update;

  // Tab key inserts two spaces instead of leaving the box
  $("css").addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const t = e.target, p = t.selectionStart;
    t.setRangeText("  ", p, t.selectionEnd, "end");
    t.dispatchEvent(new Event("input"));
  });
})();
