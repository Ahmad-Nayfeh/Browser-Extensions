importScripts("idb.js");

const MAX_HEIGHT = 30000; // CSS px; taller pages are cut (Chrome can't render bigger images reliably)

async function captureVisible(tab) {
  return { dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }), cut: false };
}

async function captureFull(tab) {
  const target = { tabId: tab.id };
  await chrome.debugger.attach(target, "1.3");
  try {
    const send = (m, p) => chrome.debugger.sendCommand(target, m, p);
    const m = await send("Page.getLayoutMetrics");
    const size = m.cssContentSize || m.contentSize;
    const width = Math.ceil(size.width);
    const height = Math.min(Math.ceil(size.height), MAX_HEIGHT);
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    return { dataUrl: "data:image/png;base64," + data, cut: size.height > MAX_HEIGHT };
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function capture(mode, tab) {
  try {
    const shot = mode === "full" ? await captureFull(tab) : await captureVisible(tab);
    const id = String(Date.now());
    await ShotDB.clear(); // keep only the latest capture on disk
    await ShotDB.put(id, { ...shot, title: tab.title, url: tab.url, mode });
    await chrome.tabs.create({ url: chrome.runtime.getURL(`editor/editor.html?id=${id}&crop=${mode === "area" ? 1 : 0}`), index: tab.index + 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "capture") { capture(msg.mode, msg.tab).then(reply); return true; }
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (tab) capture(cmd, tab);
});
