importScripts("common.js");

// Insert the user's CSS as early as possible on every page load.
// origin "USER" = it beats the site's own !important rules.
chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0) return; // top page only
  const host = hostKey(url);
  if (!host) return;
  const css = cssFor(host, await loadStyles());
  if (css) chrome.scripting.insertCSS({ target: { tabId }, css, origin: "USER" }).catch(() => {});
});
