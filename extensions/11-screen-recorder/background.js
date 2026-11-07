// Reel – background worker. It only opens the recorder page and injects the
// drawing tools; the recording itself runs in the recorder page.

const RECORDER = chrome.runtime.getURL("recorder.html");

async function openRecorder() {
  const [tab] = await chrome.tabs.query({ url: RECORDER });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    chrome.runtime.sendMessage({ type: "shortcut" }).catch(() => {}); // stops a running recording
  } else {
    await chrome.tabs.create({ url: RECORDER });
  }
}

async function injectDraw(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["draw/draw.js"] });
    return true;
  } catch {
    return false; // chrome:// pages, Web Store, PDF viewer...
  }
}

chrome.action.onClicked.addListener(openRecorder);

chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === "draw" && tab) injectDraw(tab.id);
});

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "draw") {
    // the page the user is looking at = active tab of the last focused normal window
    chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: "normal" })
      .then(([t]) => (t && t.url !== RECORDER ? injectDraw(t.id) : false))
      .then(reply);
    return true;
  }
  if (msg.type === "badge") {
    chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
    chrome.action.setBadgeText({ text: msg.text || "" });
  }
});
