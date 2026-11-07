// Why? – background worker. Nothing runs inside pages; the small bar is
// injected only at the moment it is shown.
//
// storage.local.reasons = { "<tabId>": { text, url, title, at, seen } }
//   seen = last time you looked at the tab (used for reminders)

const DEFAULTS = { ask: "many", many: 6, remindMin: 15 };
const settings = () => chrome.storage.sync.get(DEFAULTS);
const getReasons = async () => (await chrome.storage.local.get({ reasons: {} })).reasons;
// Several tab events can fire at the same moment (closing a tab also activates
// another). Each handler reads, changes and saves the list – so they must run
// one after another, or one would undo the other's change.
let queue = Promise.resolve();
const serial = (fn) => (...args) => (queue = queue.then(() => fn(...args)).catch(() => {}));
const setReasons = (reasons) => chrome.storage.local.set({ reasons });
const isWeb = (url) => /^https?:/.test(url || "");

async function show(tabId, payload) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["bar.js"] });
    await chrome.scripting.executeScript({ target: { tabId }, func: (p) => window.__whyShow(p), args: [payload] });
  } catch {} // browser pages, Web Store…
}

// ---------- asking ----------
// new tabs wait here until you actually look at them
async function pending() { return (await chrome.storage.session.get({ pending: [] })).pending; }
async function setPending(list) { await chrome.storage.session.set({ pending: list }); }

chrome.tabs.onCreated.addListener(serial(async (tab) => {
  const s = await settings();
  if (s.ask === "never") return;
  if (s.ask === "many" && (await chrome.tabs.query({ windowType: "normal" })).length <= s.many) return;
  await setPending([...(await pending()), tab.id]);
}));

async function maybeAsk(tab) {
  if (!tab || !tab.active || !isWeb(tab.url) || tab.status !== "complete") return;
  const list = await pending();
  if (!list.includes(tab.id)) return;
  await setPending(list.filter((id) => id !== tab.id));
  if ((await getReasons())[tab.id]) return;
  show(tab.id, { mode: "ask" });
}

// ---------- reminding ----------
// the tab you were on before switching is kept in session storage, because
// the worker is stopped between events and would forget a normal variable
async function onActivated(tabId) {
  const reasons = await getReasons();
  const now = Date.now();
  const { lastActive = null } = await chrome.storage.session.get("lastActive");
  if (lastActive !== null && reasons[lastActive]) reasons[lastActive].seen = now; // leaving that tab now
  await chrome.storage.session.set({ lastActive: tabId });
  const r = reasons[tabId];
  if (r) {
    const { remindMin } = await settings();
    if (now - (r.seen || r.at) > remindMin * 60000) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") show(tabId, { mode: "remind", text: r.text, at: r.at });
    }
    r.seen = now;
  }
  await setReasons(reasons);
  maybeAsk(await chrome.tabs.get(tabId).catch(() => null));
}

chrome.tabs.onActivated.addListener(serial(({ tabId }) => onActivated(tabId)));
chrome.tabs.onUpdated.addListener(serial(async (tabId, info, tab) => {
  if (info.status === "complete") maybeAsk(tab);
  if (info.title || info.url) {
    const reasons = await getReasons();
    if (reasons[tabId]) { reasons[tabId].title = tab.title; reasons[tabId].url = tab.url; await setReasons(reasons); }
  }
}));
chrome.tabs.onRemoved.addListener(serial(async (tabId) => {
  const reasons = await getReasons();
  if (reasons[tabId]) { delete reasons[tabId]; await setReasons(reasons); }
  await setPending((await pending()).filter((id) => id !== tabId));
}));

// tab ids change when Chrome restarts: re-connect reasons to tabs by their address
chrome.runtime.onStartup.addListener(async () => {
  const old = Object.values(await getReasons());
  const tabs = await chrome.tabs.query({});
  const reasons = {};
  for (const r of old) {
    const t = tabs.find((t) => t.url === r.url && !reasons[t.id]);
    if (t) reasons[t.id] = { ...r, seen: Date.now() };
  }
  await setReasons(reasons);
});

// ---------- messages from the bar / popup ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  serial(async () => {
    const tabId = msg.tabId || (sender.tab && sender.tab.id);
    const reasons = await getReasons();
    if (msg.type === "setReason") {
      const tab = await chrome.tabs.get(tabId);
      if (msg.text && msg.text.trim()) reasons[tabId] = { text: msg.text.trim(), url: tab.url, title: tab.title, at: reasons[tabId] ? reasons[tabId].at : Date.now(), seen: Date.now() };
      else delete reasons[tabId];
      await setReasons(reasons);
    }
    if (msg.type === "closeTab") chrome.tabs.remove(tabId);
    reply(true);
  })();
  return true;
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== "ask" || !tab) return;
  const r = (await getReasons())[tab.id];
  show(tab.id, { mode: "ask", text: r ? r.text : "" });
});
