// Runs inside YouTube's own page context (world: MAIN) before YouTube's scripts.
// YouTube sends the list of ads to play inside the same JSON as the video
// ("adPlacements", "playerAds", "adSlots"). We delete those keys before the
// player reads them, so the player believes there are no ads.
(() => {
  if (window.__shieldYT) return;
  window.__shieldYT = true;

  const AD_KEYS = ["adPlacements", "playerAds", "adSlots", "adBreakHeartbeatParams"];

  function prune(o) {
    if (!o || typeof o !== "object") return o;
    for (const k of AD_KEYS) if (k in o) { try { delete o[k]; } catch {} }
    if (o.playerResponse && typeof o.playerResponse === "object") prune(o.playerResponse);
    // the "please disable your ad blocker" dialog is delivered the same way
    const mr = o.auxiliaryUi && o.auxiliaryUi.messageRenderers;
    if (mr && mr.enforcementMessageViewModel) { try { delete mr.enforcementMessageViewModel; } catch {} }
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
        set: (v) => { value = prune(v); },
      });
    } catch {}
  }

  // 2) data loaded later (next video, navigation inside YouTube)
  const origParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const r = origParse.call(this, text, reviver);
    try { if (looksLikePlayerData(r)) prune(r); } catch {}
    return r;
  };
  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    return origJson.call(this).then((r) => {
      try { if (looksLikePlayerData(r)) prune(r); } catch {}
      return r;
    });
  };
})();
