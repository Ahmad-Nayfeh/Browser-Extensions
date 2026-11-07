// Shared helpers (background, popup, options).
// storage.local: { styles: { "<host>": { css, on } }, global: { css, on } }
const hostKey = (url) => {
  try { const u = new URL(url); return /^(https?|file):$/.test(u.protocol) ? (u.hostname || "local files").replace(/^www\./, "") : null; }
  catch { return null; }
};
async function loadStyles() {
  return chrome.storage.local.get({ styles: {}, global: { css: "", on: false } });
}
// CSS that applies to a host: global first, then the site's own (so the site's wins)
function cssFor(host, { styles, global }) {
  const parts = [];
  if (global.on && global.css.trim()) parts.push(global.css);
  const s = styles[host];
  if (s && s.on && s.css.trim()) parts.push(s.css);
  return parts.join("\n");
}
