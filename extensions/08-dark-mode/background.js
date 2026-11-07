// Only used for the keyboard shortcut Alt+Shift+D (toggle this site).
chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== "toggle-site" || !tab || !tab.url) return;
  let host;
  try { host = new URL(tab.url).hostname.replace(/^www\./, ""); } catch { return; }
  const { sites, on } = await chrome.storage.sync.get({ sites: {}, on: true });
  const current = sites[host] ? sites[host] === "on" : on;
  sites[host] = current ? "off" : "on";
  await chrome.storage.sync.set({ sites });
});
