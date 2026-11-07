// Speedy – content script. It only adds 3 event listeners (keydown, play,
// loadeddata) and does nothing until one of them fires. No observers, no timers.
(() => {
  if (window.__speedy) return;
  window.__speedy = true;

  const DEFAULTS = {
    speed: 1, step: 0.1, seek: 10, favorite: 1.75, remember: true,
    keys: { slower: "s", faster: "d", reset: "r", favorite: "g", back: "z", forward: "x", hide: "v" },
  };
  let s = structuredClone(DEFAULTS);
  let ready = chrome.storage.sync.get(DEFAULTS).then((v) => { s = v; });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "sync") return;
    for (const k in c) s[k] = c[k].newValue;
  });

  let lastVideo = null;
  let overlayHidden = false;
  const clamp = (v) => Math.min(16, Math.max(0.07, Math.round(v * 100) / 100));

  function pickVideo() {
    const vids = [...document.querySelectorAll("video")];
    if (!vids.length) return null;
    return vids.find((v) => !v.paused) || (lastVideo && lastVideo.isConnected ? lastVideo : null) ||
      vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  }

  let saveTimer = null;
  function setSpeed(video, v) {
    v = clamp(v);
    video.playbackRate = v;
    s.speed = v;
    if (s.remember) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => chrome.storage.sync.set({ speed: v }), 800);
    }
    show(video, v.toFixed(2) + "×");
  }

  // ---- small on-screen indicator (shadow DOM so the site's CSS can't touch it)
  let box = null, label = null, hideTimer = null;
  function show(video, text) {
    if (overlayHidden) return;
    if (!box) {
      box = document.createElement("speedy-indicator");
      const root = box.attachShadow({ mode: "closed" });
      root.innerHTML = `<style>div{position:fixed;z-index:2147483647;background:rgba(0,0,0,.72);color:#fff;
        font:600 14px system-ui,sans-serif;padding:4px 9px;border-radius:6px;pointer-events:none}</style><div></div>`;
      label = root.querySelector("div");
    }
    (document.fullscreenElement || document.documentElement).appendChild(box);
    const r = video.getBoundingClientRect();
    label.style.left = Math.max(4, r.left + 10) + "px";
    label.style.top = Math.max(4, r.top + 10) + "px";
    label.textContent = text;
    box.style.display = "";
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (box.style.display = "none"), 1200);
  }

  // ---- re-apply the remembered speed when a video starts (sites often reset it to 1)
  async function onStart(e) {
    const v = e.target;
    if (!(v instanceof HTMLMediaElement) || v.localName !== "video") return;
    lastVideo = v;
    await ready;
    if (s.remember && Math.abs(v.playbackRate - s.speed) > 0.01) v.playbackRate = s.speed;
  }
  document.addEventListener("play", onStart, true);
  document.addEventListener("loadeddata", onStart, true);

  // ---- keyboard shortcuts
  function typing(el) {
    for (let e = el; e; e = e.parentElement) {
      if (e.isContentEditable) return true;
      if (/^(input|textarea|select)$/i.test(e.localName)) return true;
    }
    return false;
  }

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (typing(e.composedPath()[0])) return;
    const key = e.key.toLowerCase();
    const action = Object.keys(s.keys).find((a) => s.keys[a] === key);
    if (!action) return;
    const v = pickVideo();
    if (!v) return; // no video here: let the site handle the key
    e.preventDefault();
    e.stopImmediatePropagation();
    switch (action) {
      case "slower": setSpeed(v, v.playbackRate - s.step); break;
      case "faster": setSpeed(v, v.playbackRate + s.step); break;
      case "reset": setSpeed(v, v.playbackRate === 1 ? s.favorite : 1); break;
      case "favorite": setSpeed(v, s.favorite); break;
      case "back": v.currentTime = Math.max(0, v.currentTime - s.seek); show(v, `−${s.seek}s`); break;
      case "forward": v.currentTime = Math.min(v.duration || Infinity, v.currentTime + s.seek); show(v, `+${s.seek}s`); break;
      case "hide": overlayHidden = !overlayHidden; break;
    }
  }, true);

  // ---- popup asks for / sets the speed of this tab
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    const v = pickVideo();
    if (!v) return;
    if (msg.type === "set") setSpeed(v, msg.speed);
    reply({ speed: v.playbackRate });
  });
})();
