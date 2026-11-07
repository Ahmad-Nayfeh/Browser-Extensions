// Runs inside YouTube's own page context (world: MAIN) before YouTube's scripts.
// YouTube sends the list of ads to play inside the same JSON as the video
// ("adPlacements", "playerAds", "adSlots"). We delete those keys before the
// player reads them, so the player believes there are no ads.
(() => {
  if (window.__shieldYT) return;
  window.__shieldYT = true;

  const AD_KEYS = ["adPlacements", "playerAds", "adSlots", "adBreakHeartbeatParams"];

  // ---- diagnostics: a few "[Shield]" lines per video in the console (Trace records them)
  // Timings are in ms since the last YouTube page change, so delays are easy to see.
  let navStart = performance.now();
  const log = (...a) => console.info(`[Shield] +${Math.round(performance.now() - navStart)}ms`, ...a);
  document.addEventListener("yt-navigate-start", () => { navStart = performance.now(); log("page change started", location.pathname + location.search); });
  document.addEventListener("shield-log", (e) => log(String(e.detail))); // messages from skip.js

  function prune(o, where) {
    if (!o || typeof o !== "object") return o;
    const removed = [];
    for (const k of AD_KEYS) if (k in o) { try { delete o[k]; removed.push(k); } catch {} }
    if (o.playerResponse && typeof o.playerResponse === "object") prune(o.playerResponse, where + " › playerResponse");
    // the "please disable your ad blocker" dialog is delivered the same way
    const mr = o.auxiliaryUi && o.auxiliaryUi.messageRenderers;
    if (mr && mr.enforcementMessageViewModel) { try { delete mr.enforcementMessageViewModel; removed.push("enforcementMessage"); } catch {} }
    if (removed.length) log(`removed ${removed.join(", ")} from ${where}`);
    return o;
  }

  function looksLikePlayerData(o) {
    return o && typeof o === "object" &&
      ("adPlacements" in o || "playerAds" in o || "adSlots" in o || "playerResponse" in o || "auxiliaryUi" in o);
  }

  // 1) data embedded in the first HTML page
  for (const name of ["ytInitialPlayerResponse", "ytInitialData"]) {
    let value;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => value,
        set: (v) => { value = prune(v, name); },
      });
    } catch (e) { log(`could not watch ${name}: ${e.message}`); }
  }

  // 2) data loaded later (next video, navigation inside YouTube)
  const origParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const r = origParse.call(this, text, reviver);
    try { if (looksLikePlayerData(r)) prune(r, "JSON.parse"); } catch {}
    return r;
  };
  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    const url = this.url;
    return origJson.call(this).then((r) => {
      try { if (looksLikePlayerData(r)) prune(r, "fetch " + new URL(url).pathname); } catch {}
      return r;
    });
  };

  // 3) when does the video really start? (and was the player in "ad mode"?)
  const seen = new WeakMap();
  for (const ev of ["loadstart", "waiting", "playing"]) {
    document.addEventListener(ev, (e) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement)) return;
      const p = v.closest(".html5-video-player");
      const ad = p && (p.classList.contains("ad-showing") || p.classList.contains("ad-interrupting"));
      const n = (seen.get(v) || 0) + 1;
      seen.set(v, n);
      if (ev !== "waiting" || n < 6) log(`video ${ev}${ad ? " (AD MODE)" : ""} at ${v.currentTime.toFixed(1)}s`);
    }, true);
  }
})();
