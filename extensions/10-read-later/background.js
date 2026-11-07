importScripts("store.js");

// Right-click menu: save a link or the current page
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "save-link", title: "Save link for later", contexts: ["link"] });
  chrome.contextMenus.create({ id: "save-page", title: "Save page for later", contexts: ["page"] });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "save-link" && savable(info.linkUrl)) {
    await Store.put({ url: info.linkUrl, title: info.selectionText || info.linkUrl, saved: true });
  }
  if (info.menuItemId === "save-page" && tab && savable(tab.url)) {
    await Store.put({ url: tab.url, title: tab.title, saved: true });
  }
  if (tab) badge(tab.id, tab.url);
});

// Badge on the icon: "•" = saved, "✎" = has a note
async function badge(tabId, url) {
  const it = savable(url) ? await Store.get(url) : null;
  const text = !it ? "" : it.note && it.note.trim() ? "✎" : "•";
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}
chrome.action.setBadgeBackgroundColor({ color: "#4f46e5" });
chrome.tabs.onActivated.addListener(async ({ tabId }) => { const t = await chrome.tabs.get(tabId); badge(tabId, t.url); });
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === "complete" || info.url) badge(tabId, tab.url); });
chrome.storage.onChanged.addListener(async (c) => {
  if (!c.items) return;
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (t) badge(t.id, t.url);
});
