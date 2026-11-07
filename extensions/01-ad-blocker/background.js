// Shield – background service worker.
// Chrome runs this only when an event arrives and stops it when idle,
// so it costs nothing while you browse normally.

const RULESETS = ["easylist", "easyprivacy", "peterlowe", "youtube"];
const ALLOWLIST_RULE_ID = 1;
const YT_MATCHES = ["*://*.youtube.com/*", "*://*.youtube-nocookie.com/*"];

// ---------- state ----------
async function getState() {
  const s = await chrome.storage.local.get({ paused: false, allowlist: [], userFilters: {} });
  return s;
}

function hostOf(url) {
  try {
    const u = new URL(url);
    return u.protocol.startsWith("http") ? u.hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

// true when host equals d or is a sub-domain of d
function hostMatches(host, d) {
  return host === d || host.endsWith("." + d);
}

function isAllowlisted(host, allowlist) {
  return allowlist.some((d) => hostMatches(host, d));
}

// ---------- apply state to Chrome ----------
async function sync() {
  const { paused, allowlist } = await getState();

  // 1. static rulesets on/off
  const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
  if (paused) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: enabled });
  } else {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: RULESETS.filter((r) => !enabled.includes(r)),
    });
  }

  // 2. allowlist = one dynamic "allow everything" rule for those sites
  const addRules = allowlist.length
    ? [{
        id: ALLOWLIST_RULE_ID,
        priority: 100,
        action: { type: "allowAllRequests" },
        condition: { requestDomains: allowlist, resourceTypes: ["main_frame", "sub_frame"] },
      }]
    : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ALLOWLIST_RULE_ID], addRules });

  // 3. content scripts (generic element hiding + YouTube)
  const old = await chrome.scripting.getRegisteredContentScripts();
  if (old.length) await chrome.scripting.unregisterContentScripts({ ids: old.map((s) => s.id) });
  if (paused) return;

  const generichide = await loadJSON("filters/generichide.json");
  // "*.example.com" in a match pattern covers example.com and all its sub-domains
  const exclude = [...new Set([...allowlist, ...generichide])]
    .filter((d) => /^[a-z0-9.-]+$/.test(d))
    .map((d) => `*://*.${d}/*`);
  const ytAllowed = isAllowlisted("youtube.com", allowlist);

  const scripts = [{
    id: "generic-css",
    matches: ["<all_urls>"],
    excludeMatches: exclude,
    css: ["filters/generic.css"],
    runAt: "document_start",
    allFrames: true,
  }];
  if (!ytAllowed) {
    scripts.push(
      { id: "yt-main", matches: YT_MATCHES, js: ["youtube/inject.js"], runAt: "document_start", allFrames: true, world: "MAIN" },
      { id: "yt-skip", matches: YT_MATCHES, js: ["youtube/skip.js"], css: ["youtube/youtube.css"], runAt: "document_start", allFrames: true }
    );
  }
  await chrome.scripting.registerContentScripts(scripts);
}

// ---------- site-specific element hiding ----------
let specificCache = null, exceptCache = null, generichideCache = null;
async function loadJSON(path) {
  const r = await fetch(chrome.runtime.getURL(path));
  return r.json();
}

function selectorsFor(host, specific, userFilters) {
  const parts = host.split(".");
  const out = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join(".");
    if (specific[d]) out.push(...specific[d]);
    if (userFilters[d]) out.push(...userFilters[d]);
    const entity = parts[i] + ".*"; // e.g. "google.*"
    if (specific[entity]) out.push(...specific[entity]);
  }
  return out;
}

chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  const host = hostOf(url);
  if (!host) return;
  const { paused, allowlist, userFilters } = await getState();
  if (paused || isAllowlisted(host, allowlist)) return;
  specificCache ??= await loadJSON("filters/specific.json");
  const sels = selectorsFor(host, specificCache, userFilters);
  // general rules that some sites asked to skip: apply them everywhere except there
  exceptCache ??= await loadJSON("filters/generic-except.json");
  generichideCache ??= await loadJSON("filters/generichide.json");
  if (!generichideCache.some((d) => hostMatches(host, d))) {
    for (const [sel, sites] of exceptCache) if (!sites.some((d) => hostMatches(host, d))) sels.push(sel);
  }
  if (!sels.length) return;
  // one rule per selector: an invalid selector then only breaks itself
  const css = sels.map((s) => `${s}{display:none!important}`).join("\n");
  chrome.scripting
    .insertCSS({ target: { tabId, frameIds: [frameId] }, css, origin: "USER" })
    .catch(() => {}); // e.g. chrome:// pages or the Web Store
});

// ---------- messages from popup / picker / options ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const state = await getState();
    switch (msg.type) {
      case "getState":
        reply({ ...state, siteAllowed: msg.host ? isAllowlisted(msg.host, state.allowlist) : false });
        return;
      case "toggleSite": {
        const list = state.allowlist.filter((d) => !hostMatches(msg.host, d));
        if (list.length === state.allowlist.length) list.push(msg.host);
        await chrome.storage.local.set({ allowlist: list });
        break;
      }
      case "removeAllowed":
        await chrome.storage.local.set({ allowlist: state.allowlist.filter((d) => d !== msg.host) });
        break;
      case "setPaused":
        await chrome.storage.local.set({ paused: msg.paused });
        break;
      case "addUserFilter": {
        const uf = state.userFilters;
        uf[msg.host] = [...new Set([...(uf[msg.host] || []), msg.selector])];
        await chrome.storage.local.set({ userFilters: uf });
        reply({ ok: true });
        return; // no need to re-sync scripts
      }
      case "removeUserFilter": {
        const uf = state.userFilters;
        uf[msg.host] = (uf[msg.host] || []).filter((s) => s !== msg.selector);
        if (!uf[msg.host].length) delete uf[msg.host];
        await chrome.storage.local.set({ userFilters: uf });
        reply({ ok: true });
        return;
      }
    }
    await sync();
    reply({ ok: true });
  })();
  return true; // async reply
});

// ---------- lifecycle ----------
async function init() {
  await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  await chrome.action.setBadgeBackgroundColor({ color: "#4b5563" });
  await sync();
}
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
