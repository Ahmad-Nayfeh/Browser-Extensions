// Fallback: if an ad still starts (YouTube changes its code often),
// mute it, jump to its end and press "Skip". Uses one attribute observer
// on the player only - no polling, no page-wide observers.
(() => {
  const watched = new WeakSet();
  let mutedByUs = false;

  function handle(player) {
    const video = player.querySelector("video");
    if (!video) return;
    const ad = player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting");
    if (ad) {
      if (!video.muted) { video.muted = true; mutedByUs = true; }
      if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration;
      try { video.playbackRate = 16; } catch {}
      for (const b of player.querySelectorAll(".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern")) b.click();
    } else if (mutedByUs) {
      video.muted = false;
      mutedByUs = false;
    }
  }

  function watch(player) {
    if (watched.has(player)) return;
    watched.add(player);
    new MutationObserver(() => handle(player)).observe(player, { attributes: true, attributeFilter: ["class"] });
    handle(player);
  }

  // every ad is a video playback, so a "play" event is our cheap signal
  for (const ev of ["play", "loadedmetadata"]) {
    document.addEventListener(ev, (e) => {
      const p = e.target && e.target.closest && e.target.closest(".html5-video-player");
      if (p) watch(p);
    }, true);
  }
})();
