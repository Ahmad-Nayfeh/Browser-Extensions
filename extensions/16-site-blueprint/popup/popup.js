const $ = (id) => document.getElementById(id);
const DEF = { css: true, html: true, screenshot: true };
(async () => {
  const o = await chrome.storage.sync.get(DEF);
  for (const k of Object.keys(DEF)) { $(k).checked = o[k]; $(k).onchange = (e) => chrome.storage.sync.set({ [k]: e.target.checked }); }
  chrome.runtime.onMessage.addListener((m) => { if (m.type === "progress") $("msg").textContent = m.text; });
  $("go").onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    $("go").disabled = true;
    $("msg").textContent = "Starting…";
    const opts = { css: $("css").checked, html: $("html").checked, screenshot: $("screenshot").checked };
    const r = await chrome.runtime.sendMessage({ type: "analyze", tab, opts });
    if (r && r.ok) window.close();
    else { $("msg").textContent = "Can't analyze this page: " + (r && r.error); $("go").disabled = false; }
  };
})();
