// Clean Tube – sets one attribute per enabled switch on <html>; clean.css
// does the hiding. Pure CSS = the browser does the work, nothing loops.
(() => {
  const KEYS = Object.keys(CLEAN_OPTIONS); // from options.js
  const html = document.documentElement;

  function apply(opts) {
    for (const k of KEYS) {
      if (opts[k]) html.setAttribute("data-ct-" + k, "");
      else html.removeAttribute("data-ct-" + k);
    }
    redirectShorts(opts);
  }

  // /shorts/ID  ->  /watch?v=ID  (normal player: seek bar, speed, no endless scroll)
  let current = {};
  function redirectShorts(opts = current) {
    if (!opts.shorts) return;
    const m = location.pathname.match(/^\/shorts\/([\w-]{6,})/);
    if (m) location.replace(`/watch?v=${m[1]}`);
  }

  const defaults = Object.fromEntries(KEYS.map((k) => [k, CLEAN_OPTIONS[k].def]));
  chrome.storage.sync.get(defaults).then((o) => { current = o; apply(o); });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "sync") return;
    for (const k in c) current[k] = c[k].newValue;
    apply(current);
  });
  // YouTube changes pages without reloading; it fires this event after each change
  document.addEventListener("yt-navigate-finish", () => redirectShorts());
  window.addEventListener("popstate", () => redirectShorts());
})();
