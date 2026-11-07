const $ = (id) => document.getElementById(id);
const DEFAULTS = { enabled: true, minutes: 30, skipPinned: true, skipAudible: true, neverSites: [] };

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try { const u = new URL(tab.url); if (u.protocol.startsWith("http")) host = u.hostname.replace(/^www\./, ""); } catch {}
  const s = await chrome.storage.sync.get(DEFAULTS);

  async function stats() {
    const all = await chrome.tabs.query({});
    $("stats").textContent = `${all.filter((t) => t.discarded).length} of ${all.length} tabs sleeping`;
  }
  stats();

  $("enabled").checked = s.enabled;
  $("minutes").value = s.minutes;
  $("skipPinned").checked = s.skipPinned;
  $("skipAudible").checked = s.skipAudible;
  $("host").textContent = host || "this site";
  $("never").disabled = !host;
  $("never").checked = !!host && s.neverSites.includes(host);

  const save = (patch) => chrome.storage.sync.set(patch);
  $("enabled").onchange = (e) => save({ enabled: e.target.checked });
  $("minutes").onchange = (e) => save({ minutes: Math.max(1, Math.min(1440, +e.target.value || 30)) });
  $("skipPinned").onchange = (e) => save({ skipPinned: e.target.checked });
  $("skipAudible").onchange = (e) => save({ skipAudible: e.target.checked });
  $("never").onchange = async (e) => {
    const { neverSites } = await chrome.storage.sync.get(DEFAULTS);
    const list = neverSites.filter((d) => d !== host);
    if (e.target.checked) list.push(host);
    save({ neverSites: list });
  };
  $("sleepNow").onclick = async () => {
    const n = await chrome.runtime.sendMessage({ type: "sleepOthers", windowId: tab.windowId });
    $("sleepNow").textContent = `${n} tab(s) put to sleep`;
    stats();
  };
  $("save").onclick = async () => {
    await chrome.runtime.sendMessage({ type: "saveWindow", windowId: tab.windowId });
    window.close();
  };
  $("list").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("sessions/sessions.html") });
})();
