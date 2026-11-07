const $ = (id) => document.getElementById(id);
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = null;
  try { const u = new URL(tab.url); if (/^https?:$/.test(u.protocol)) host = u.hostname.replace(/^www\./, ""); } catch {}
  const s = await chrome.storage.local.get({ off: [], autoReject: true });
  $("title").textContent = await chrome.action.getTitle({ tabId: tab.id });
  $("host").textContent = host || "this page";
  $("site").disabled = !host;
  $("site").checked = !!host && !s.off.includes(host);
  $("auto").checked = s.autoReject;

  const save = async (patch) => {
    await chrome.storage.local.set(patch);
    await chrome.runtime.sendMessage({ type: "sync" });
    chrome.tabs.reload(tab.id);
  };
  $("site").onchange = async (e) => {
    const { off } = await chrome.storage.local.get({ off: [] });
    save({ off: e.target.checked ? off.filter((d) => d !== host) : [...off, host] });
  };
  $("auto").onchange = (e) => save({ autoReject: e.target.checked });
})();
