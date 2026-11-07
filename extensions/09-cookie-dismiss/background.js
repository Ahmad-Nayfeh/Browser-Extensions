// No Cookies – background worker (same light design as Shield):
// the generic hiding CSS and the auto-reject script are registered once and
// injected by Chrome itself; site-specific rules are added per page load.

const DEF = { off: [], autoReject: true };
const getState = () => chrome.storage.local.get(DEF);
const hostOf = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "") : null; } catch { return null; } };
const isOff = (host, off) => off.some((d) => host === d || host.endsWith("." + d));

async function sync() {
  const { off, autoReject } = await getState();
  const old = await chrome.scripting.getRegisteredContentScripts();
  if (old.length) await chrome.scripting.unregisterContentScripts({ ids: old.map((s) => s.id) });
  const generichide = await (await fetch(chrome.runtime.getURL("filters/generichide.json"))).json();
  const exclude = (list) => list.filter((d) => /^[a-z0-9.-]+$/.test(d)).map((d) => `*://*.${d}/*`);
  const scripts = [{
    id: "hide", matches: ["<all_urls>"], excludeMatches: exclude([...off, ...generichide]),
    css: ["filters/generic.css"], runAt: "document_start", allFrames: true,
  }];
  if (autoReject) scripts.push({
    id: "reject", matches: ["<all_urls>"], excludeMatches: exclude(off),
    js: ["autoclick.js"], runAt: "document_idle", allFrames: true,
  });
  await chrome.scripting.registerContentScripts(scripts);
}

let specific = null;
chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  const host = hostOf(url);
  if (!host) return;
  const { off } = await getState();
  if (isOff(host, off)) return;
  specific ??= await (await fetch(chrome.runtime.getURL("filters/specific.json"))).json();
  const parts = host.split(".");
  const sels = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join(".");
    if (specific[d]) sels.push(...specific[d]);
    if (specific[parts[i] + ".*"]) sels.push(...specific[parts[i] + ".*"]);
  }
  if (sels.length) {
    chrome.scripting.insertCSS({ target: { tabId, frameIds: [frameId] }, css: sels.map((s) => `${s}{display:none!important}`).join("\n"), origin: "USER" }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "rejected" && sender.tab) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: "✓" });
    chrome.action.setTitle({ tabId: sender.tab.id, title: `No Cookies – rejected (${msg.name})` });
    return;
  }
  if (msg.type === "sync") { sync().then(() => reply(true)); return true; }
});

async function init() {
  await chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
  await sync();
}
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
