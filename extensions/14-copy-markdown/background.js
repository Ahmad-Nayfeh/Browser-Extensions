// Copy as Markdown – nothing runs in your pages until you ask for a copy.

async function convert(tabId, mode) {
  const { header = true } = await chrome.storage.sync.get("header");
  await chrome.scripting.executeScript({ target: { tabId }, files: ["mathjax-main.js"], world: "MAIN" }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, files: ["converter.js"] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (mode, header) => window.__copyMarkdown({ mode, header }),
    args: [mode, header],
  });
  return result;
}

// The clipboard can only be written from a page; an invisible "offscreen"
// page does it for the right-click menu and the keyboard shortcut.
async function copyText(text) {
  const has = await chrome.offscreen.hasDocument();
  if (!has) await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["CLIPBOARD"], justification: "Copy Markdown to the clipboard" });
  await chrome.runtime.sendMessage({ type: "offscreen-copy", text });
}

async function toast(tabId, text) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (text) => {
      const d = document.createElement("div");
      d.textContent = text;
      d.style.cssText = "all:initial;position:fixed;z-index:2147483647;bottom:20px;left:50%;transform:translateX(-50%);background:#18181b;color:#fff;font:600 13px system-ui,sans-serif;padding:9px 14px;border-radius:9px;box-shadow:0 6px 20px rgba(0,0,0,.3)";
      document.documentElement.appendChild(d);
      setTimeout(() => d.remove(), 1800);
    },
    args: [text],
  }).catch(() => {});
}

async function run(tabId, mode) {
  try {
    const r = await convert(tabId, mode);
    await copyText(r.md);
    toast(tabId, r.mode === "page" ? "Article copied as Markdown ✓" : "Selection copied as Markdown ✓");
  } catch (e) {
    toast(tabId, "Copy as Markdown: this page can't be read");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "sel", title: "Copy selection as Markdown", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "page", title: "Copy page as Markdown", contexts: ["page"] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => tab && run(tab.id, info.menuItemId === "sel" ? "selection" : "page"));
chrome.commands.onCommand.addListener((cmd, tab) => { if (cmd === "copy" && tab) run(tab.id, "auto"); });

// the popup asks for a preview
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "convert") { convert(msg.tabId, msg.mode).then(reply, (e) => reply({ error: e.message })); return true; }
});
