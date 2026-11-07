const $ = (id) => document.getElementById(id);
const DEF = { scope: "page", maxPages: 10, api: true, scroll: true, screenshot: true, css: true, html: true };
(async () => {
  const o = await chrome.storage.sync.get(DEF);
  for (const k of ["api", "scroll", "screenshot", "css", "html"]) { $(k).checked = o[k]; $(k).onchange = (e) => chrome.storage.sync.set({ [k]: e.target.checked }); }
  $("maxPages").value = o.maxPages;
  $("maxPages").onchange = (e) => chrome.storage.sync.set({ maxPages: Math.min(50, Math.max(2, +e.target.value || 10)) });
  document.querySelectorAll("[name=scope]").forEach((r) => { r.checked = r.value === o.scope; r.onchange = () => chrome.storage.sync.set({ scope: r.value }); });

  // an analysis may still be running from before
  const { running } = await chrome.runtime.sendMessage({ type: "status" });
  if (running) { $("go").disabled = true; $("msg").textContent = (await chrome.storage.session.get("progress")).progress || "Working…"; }
  chrome.runtime.onMessage.addListener((m) => { if (m.type === "progress") $("msg").textContent = m.text; });

  $("go").onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    $("go").disabled = true;
    $("msg").textContent = "Starting…";
    const s = await chrome.storage.sync.get(DEF);
    const r = await chrome.runtime.sendMessage({ type: "analyze", tab, opts: s });
    if (r && r.ok) window.close();
    else { $("msg").textContent = "Can't analyze this page: " + (r && r.error); $("go").disabled = false; }
  };
})();
