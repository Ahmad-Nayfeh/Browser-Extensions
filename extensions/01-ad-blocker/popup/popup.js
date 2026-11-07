const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = null;
  try {
    const u = new URL(tab.url);
    if (u.protocol.startsWith("http")) host = u.hostname.replace(/^www\./, "");
  } catch {}

  // the icon's badge shows the count automatically, but Chrome hides the number
  // from getBadgeText(); clicking the icon (activeTab) lets us ask for it instead
  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId: tab.id });
    // ids >= 900000 are exception ("allow") rules – they don't block anything
    $("count").textContent = rulesMatchedInfo.filter((m) => m.rule.rulesetId !== "_dynamic" && m.rule.ruleId < 900000).length;
  } catch {
    $("count").textContent = "–";
  }
  $("host").textContent = host || "This page can't be filtered";

  async function render() {
    const s = await send({ type: "getState", host });
    $("site").checked = !!host && !s.siteAllowed && !s.paused;
    $("site").disabled = !host || s.paused;
    $("pick").disabled = !host || s.paused;
    $("siteNote").textContent = s.paused ? "Paused everywhere" : s.siteAllowed ? "Allowed (not blocking)" : "Ads & trackers blocked";
    $("pause").textContent = s.paused ? "Resume blocking" : "Pause everywhere";
    $("pause").classList.toggle("primary", s.paused);
    $("pause").dataset.paused = s.paused ? "1" : "";
  }
  await render();

  const changed = async () => {
    await render();
    $("reloadHint").hidden = false;
    chrome.tabs.reload(tab.id);
  };

  $("site").onchange = async () => { await send({ type: "toggleSite", host }); changed(); };
  $("pause").onclick = async () => { await send({ type: "setPaused", paused: !$("pause").dataset.paused }); changed(); };
  $("opts").onclick = () => chrome.runtime.openOptionsPage();
  $("pick").onclick = async () => {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["picker/picker.js"] });
    window.close();
  };
})();
