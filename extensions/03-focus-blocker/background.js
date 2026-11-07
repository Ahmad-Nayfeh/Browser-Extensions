// Focus – background worker.
// Blocking is done by Chrome's rule engine (a redirect rule per site), so
// nothing runs inside the pages you visit. Time tracking only listens to
// tab/window/idle events – no timers ticking every second.

// sites: [{ domain, mode: "block" | "limit", minutes }]
const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
const hostOf = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "") : ""; } catch { return ""; } };
const matchSite = (host, sites) => sites.find((s) => host === s.domain || host.endsWith("." + s.domain));

async function getSites() { return (await chrome.storage.sync.get({ sites: [] })).sites; }

async function getUsage() {
  const { usage } = await chrome.storage.local.get({ usage: { date: today(), used: {} } });
  return usage.date === today() ? usage : { date: today(), used: {} };
}

// ---------- rules ----------
async function rebuildRules() {
  const sites = await getSites();
  const { used } = await getUsage();
  const blocked = sites.filter((s) => s.mode === "block" || (used[s.domain] || 0) >= s.minutes * 60000);
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map((r) => r.id),
    addRules: blocked.map((s, i) => ({
      id: i + 1,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { extensionPath: `/blocked/blocked.html?d=${encodeURIComponent(s.domain)}&m=${s.mode}` },
      },
      condition: { requestDomains: [s.domain], resourceTypes: ["main_frame"] },
    })),
  });
  return blocked;
}

// reload open tabs of sites that just became blocked (single-page sites never re-request)
async function enforce() {
  const blocked = await rebuildRules();
  if (!blocked.length) return;
  for (const t of await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] })) {
    if (matchSite(hostOf(t.url), blocked)) chrome.tabs.reload(t.id);
  }
}

// ---------- time tracking ----------
// "current" = the limited site that is in the focused window's active tab right now
async function tickNow() {
  const now = Date.now();
  const { current } = await chrome.storage.session.get({ current: null });
  const usage = await getUsage();
  if (current) {
    usage.used[current.domain] = (usage.used[current.domain] || 0) + (now - current.since);
  }
  await chrome.storage.local.set({ usage });

  // what is in front of the user now?
  let next = null;
  const sites = (await getSites()).filter((s) => s.mode === "limit");
  const state = await chrome.idle.queryState(60);
  if (sites.length && state === "active") {
    try {
      const win = await chrome.windows.getLastFocused();
      if (win.focused) {
        const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
        const site = tab && matchSite(hostOf(tab.url), sites);
        if (site) next = { domain: site.domain, since: now };
      }
    } catch {}
  }
  await chrome.storage.session.set({ current: next });

  await chrome.alarms.clear("limit");
  if (next) {
    const site = sites.find((s) => s.domain === next.domain);
    const left = site.minutes * 60000 - (usage.used[next.domain] || 0);
    if (left <= 0) await enforce();
    else chrome.alarms.create("limit", { when: now + left + 500 });
  }
}

// run ticks one after another so two events can't count the same seconds twice
let queue = Promise.resolve();
function tick() { queue = queue.then(tickNow).catch(() => {}); return queue; }

function scheduleMidnight() {
  const d = new Date();
  d.setHours(24, 0, 5, 0);
  chrome.alarms.create("midnight", { when: d.getTime() });
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === "limit") { await tick(); await enforce(); }
  if (a.name === "midnight") { await chrome.storage.local.set({ usage: { date: today(), used: {} } }); await rebuildRules(); scheduleMidnight(); await tick(); }
});

chrome.tabs.onActivated.addListener(tick);
chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (info.url && tab.active) tick(); });
chrome.windows.onFocusChanged.addListener(tick);
chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener(tick);

chrome.storage.onChanged.addListener((c, area) => { if (area === "sync" && c.sites) enforce().then(tick); });

async function init() { scheduleMidnight(); await rebuildRules(); await tick(); }
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "usage") { tick().then(getUsage).then(reply); return true; }
});
