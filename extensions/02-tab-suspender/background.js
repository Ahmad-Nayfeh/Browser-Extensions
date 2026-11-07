// Sleepy Tabs – checks once a minute (a Chrome alarm wakes the worker briefly)
// and discards tabs you haven't looked at for a while. A discarded tab keeps
// its place and title but its page is unloaded from memory; clicking it
// reloads the page.

const DEFAULTS = { enabled: true, minutes: 30, skipPinned: true, skipAudible: true, neverSites: [] };
const getSettings = () => chrome.storage.sync.get(DEFAULTS);

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const isNever = (url, list) => { const h = hostOf(url); return list.some((d) => h === d || h.endsWith("." + d)); };

function canSleep(tab, s) {
  if (tab.active || tab.discarded) return false;
  if (!/^https?:/.test(tab.url || "")) return false;     // chrome:// pages, files, etc.
  if (s.skipPinned && tab.pinned) return false;
  if (s.skipAudible && tab.audible) return false;
  if (isNever(tab.url, s.neverSites)) return false;
  return true;
}

async function sleepTabs({ olderThanMs = null, windowId = undefined } = {}) {
  const s = await getSettings();
  const tabs = await chrome.tabs.query(windowId === undefined ? {} : { windowId });
  const now = Date.now();
  let n = 0;
  for (const t of tabs) {
    if (!canSleep(t, s)) continue;
    if (olderThanMs !== null && now - (t.lastAccessed || now) < olderThanMs) continue;
    try { await chrome.tabs.discard(t.id); n++; } catch {}
  }
  return n;
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "check") return;
  const s = await getSettings();
  if (s.enabled) await sleepTabs({ olderThanMs: s.minutes * 60000 });
});

async function ensureAlarm() {
  if (!(await chrome.alarms.get("check"))) chrome.alarms.create("check", { periodInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

// ---------- saved sessions (save & close a window, restore later) ----------
async function saveWindow(windowId) {
  const tabs = (await chrome.tabs.query({ windowId })).filter((t) => /^(https?|file|ftp):/.test(t.url || ""));
  if (!tabs.length) return 0;
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  sessions.unshift({
    id: Date.now(),
    date: new Date().toISOString(),
    tabs: tabs.map((t) => ({ url: t.url, title: t.title || t.url })),
  });
  await chrome.storage.local.set({ sessions });
  // open the list first so the window doesn't close when its last tab goes
  await chrome.tabs.create({ windowId, url: chrome.runtime.getURL("sessions/sessions.html") });
  await chrome.tabs.remove(tabs.map((t) => t.id));
  return tabs.length;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === "sleepOthers") reply(await sleepTabs({ windowId: msg.windowId }));
    else if (msg.type === "saveWindow") reply(await saveWindow(msg.windowId));
  })();
  return true;
});
