importScripts("idb.js");

// Trace – click the icon to start, click again to stop.
// state (survives the worker sleeping): storage.session.rec = { tabs: [ids], start }

const DEF_OPTS = { maskAll: false, logs: false, html: true, shots: true, visual: true };
const getRec = async () => (await chrome.storage.session.get("rec")).rec || null;
const setRec = (rec) => (rec ? chrome.storage.session.set({ rec }) : chrome.storage.session.remove("rec"));

async function setBadge(on) {
  await chrome.action.setBadgeBackgroundColor({ color: "#be123c" });
  await chrome.action.setBadgeText({ text: on ? "REC" : "" });
  await chrome.action.setTitle({ title: on ? "Trace – recording… click to stop and get the report" : "Trace – click to start recording" });
}

async function injectNow(tabId) {
  // the page is already open: add the recorder to it now (later pages get it automatically)
  await chrome.scripting.executeScript({ target: { tabId }, files: ["hook-main.js"], world: "MAIN" }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, files: ["capture.js"] }).catch(() => {});
}

async function start(tab) {
  await TraceDB.clear();
  await chrome.storage.session.remove("lastShot");
  const opts = await chrome.storage.sync.get(DEF_OPTS);
  await setRec({ tabs: [tab.id], start: Date.now(), opts });
  await TraceDB.add({ t: Date.now(), type: "start", url: tab.url, title: tab.title, tab: tab.id, ua: navigator.userAgent, opts });
  // while recording, every page load gets the recorder from its first moment
  await chrome.scripting.registerContentScripts([
    { id: "trace-main", matches: ["<all_urls>"], js: ["hook-main.js"], runAt: "document_start", world: "MAIN", persistAcrossSessions: false },
    { id: "trace-capture", matches: ["<all_urls>"], js: ["capture.js"], runAt: "document_start", persistAcrossSessions: false },
  ]).catch(() => {});
  await setBadge(true);
  await injectNow(tab.id);
  scheduleShot(tab.id);
}

async function stop() {
  const rec = await getRec();
  if (!rec) return;
  if (shotTimer) { clearTimeout(shotTimer); shotTimer = null; await takeShot(rec.tabs[0]).catch(() => {}); } // the last screen
  await setRec(null);
  await chrome.scripting.unregisterContentScripts({ ids: ["trace-main", "trace-capture"] }).catch(() => {});
  for (const id of rec.tabs) {
    chrome.scripting.executeScript({ target: { tabId: id }, func: () => document.dispatchEvent(new CustomEvent("__trace_capture_stop")) }).catch(() => {});
  }
  await TraceDB.add({ t: Date.now(), type: "stop" });
  await setBadge(false);
  chrome.tabs.create({ url: chrome.runtime.getURL("report.html") });
}

chrome.action.onClicked.addListener(async (tab) => ((await getRec()) ? stop() : start(tab)));

// a link that opens a new tab from the tested site is recorded too
chrome.tabs.onCreated.addListener(async (t) => {
  const rec = await getRec();
  if (rec && t.openerTabId && rec.tabs.includes(t.openerTabId)) {
    rec.tabs.push(t.id);
    await setRec(rec);
    TraceDB.add({ t: Date.now(), type: "new-tab", tab: t.id, from: t.openerTabId });
  }
});
chrome.tabs.onRemoved.addListener(async (id) => {
  const rec = await getRec();
  if (!rec || !rec.tabs.includes(id)) return;
  rec.tabs = rec.tabs.filter((x) => x !== id);
  await TraceDB.add({ t: Date.now(), type: "tab-closed", tab: id });
  if (rec.tabs.length) await setRec(rec); else await stop(); // last tested tab closed = done
});

chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const rec = await getRec();
  if (rec && rec.tabs.includes(d.tabId)) TraceDB.add({ t: Date.now(), type: "nav", url: d.url, how: d.transitionType, qualifiers: d.transitionQualifiers, tab: d.tabId });
});
chrome.webNavigation.onHistoryStateUpdated.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const rec = await getRec();
  if (rec && rec.tabs.includes(d.tabId)) { TraceDB.add({ t: Date.now(), type: "route", url: d.url, tab: d.tabId }); scheduleShot(d.tabId); }
});

// ---------- a screenshot after each step ----------
// Taken 1.2 s after you stop acting (so the page has reacted), only while the
// tested tab is the one on screen. Shrunk to 1280 px wide JPEG to stay small.
const SHOT_AFTER = new Set(["click", "dblclick", "input", "submit", "key", "page", "nav", "route"]);
let shotTimer = null;
function scheduleShot(tabId) {
  clearTimeout(shotTimer);
  shotTimer = setTimeout(() => takeShot(tabId).catch(() => {}), 1200);
}
async function takeShot(tabId) {
  const rec = await getRec();
  if (!rec || !rec.opts.shots || !rec.tabs.includes(tabId)) return;
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active) return;
  const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const scale = Math.min(1, 1280 / bmp.width);
  const c = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.7 });
  // the screen didn't change since the last picture? don't keep a copy
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-1", await blob.arrayBuffer()))].join(",");
  const { lastShot } = await chrome.storage.session.get("lastShot");
  if (hash === lastShot) return;
  await chrome.storage.session.set({ lastShot: hash });
  await TraceDB.add({ t: Date.now(), type: "shot", tab: tabId, blob, url: tab.url });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const rec = await getRec();
    const tabId = sender.tab && sender.tab.id;
    const mine = !!rec && rec.tabs.includes(tabId) && sender.frameId === 0;
    if (msg.type === "trace-hello") reply({ recording: mine, opts: mine ? rec.opts : null });
    else if (msg.type === "trace" && mine) {
      await TraceDB.add({ ...msg.ev, tab: tabId });
      if (SHOT_AFTER.has(msg.ev.type) || (msg.ev.type === "dom" && msg.ev.appeared && msg.ev.appeared.length)) scheduleShot(tabId);
      reply(true);
    }
    else reply(false);
  })();
  return true;
});

chrome.runtime.onStartup.addListener(() => { setRec(null); setBadge(false); });
