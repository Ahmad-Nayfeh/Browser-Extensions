// Reel – drawing layer on top of a web page (for recordings and presentations).
// Injected only when you ask for it; running it again closes it.
// Nothing runs while you are not drawing: the canvas is redrawn only during a
// stroke or while "fade" strokes are disappearing.
(() => {
  if (window.__reelDraw) { window.__reelDraw(); return; }

  const host = document.createElement("reel-draw");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
  <style>
    canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; }
    .bar { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; align-items: center;
      background: #18181b; padding: 6px; border-radius: 12px; box-shadow: 0 6px 20px rgba(0,0,0,.35); pointer-events: auto;
      font: 12px system-ui, sans-serif; color: #f4f4f5; }
    .bar button { font: inherit; border: 0; background: #27272a; color: #f4f4f5; border-radius: 8px; padding: 6px 8px; cursor: pointer; }
    .bar button.on { background: #2563eb; }
    .sw { width: 18px; height: 18px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0 !important; }
    .sw.on { border-color: #fff; }
    .sep { width: 1px; height: 20px; background: #3f3f46; margin: 0 2px; }
    .halo { position: fixed; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
      background: rgba(250,204,21,.35); border: 2px solid rgba(250,204,21,.8); pointer-events: none; display: none; }
    .spot { position: fixed; inset: 0; pointer-events: none; display: none; }
  </style>
  <canvas></canvas>
  <div class="spot"></div>
  <div class="halo"></div>
  <div class="bar">
    <button data-t="mouse" title="Use the page normally (1)">↖</button>
    <button data-t="pen" title="Pen (2)">✎</button>
    <button data-t="marker" title="Highlighter (3)">▮</button>
    <button data-t="arrow" title="Arrow (4)">➚</button>
    <button data-t="rect" title="Box (5)">▭</button>
    <button data-t="spot" title="Spotlight around the mouse (6)">◉</button>
    <span class="sep"></span>
    <span class="sw" data-c="#ef4444" style="background:#ef4444"></span>
    <span class="sw" data-c="#facc15" style="background:#facc15"></span>
    <span class="sw" data-c="#22c55e" style="background:#22c55e"></span>
    <span class="sw" data-c="#3b82f6" style="background:#3b82f6"></span>
    <span class="sw" data-c="#ffffff" style="background:#fff"></span>
    <span class="sep"></span>
    <button data-a="halo" title="Yellow circle around the mouse">Cursor</button>
    <button data-a="fade" title="Drawings disappear after 3 seconds">Fade</button>
    <button data-a="clear" title="Clear (C)">Clear</button>
    <button data-a="close" title="Close (Esc)">✕</button>
  </div>`;
  document.documentElement.appendChild(host);

  const cv = root.querySelector("canvas");
  const ctx = cv.getContext("2d");
  const halo = root.querySelector(".halo");
  const spot = root.querySelector(".spot");
  let tool = "pen", color = "#ef4444", fade = false, haloOn = false;
  let shapes = [], cur = null, raf = 0;
  const FADE_MS = 3000;

  function size() {
    const dpr = devicePixelRatio || 1;
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  function arrow(s) {
    const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), h = 18;
    ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s.x2, s.y2);
    ctx.lineTo(s.x2 - h * Math.cos(a - 0.45), s.y2 - h * Math.sin(a - 0.45));
    ctx.lineTo(s.x2 - h * Math.cos(a + 0.45), s.y2 - h * Math.sin(a + 0.45));
    ctx.closePath(); ctx.fill();
  }

  function paint(s, alpha) {
    ctx.globalAlpha = alpha * (s.t === "marker" ? 0.35 : 1);
    ctx.strokeStyle = ctx.fillStyle = s.c;
    ctx.lineWidth = s.t === "marker" ? 22 : 4;
    ctx.lineCap = ctx.lineJoin = "round";
    if (s.t === "pen" || s.t === "marker") {
      ctx.beginPath();
      s.p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    } else if (s.t === "arrow") arrow(s);
    else if (s.t === "rect") ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
  }

  function redraw() {
    raf = 0;
    const now = performance.now();
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    shapes = shapes.filter((s) => !s.end || now - s.end < FADE_MS);
    let fading = false;
    for (const s of shapes) {
      let a = 1;
      if (s.end) { a = 1 - (now - s.end) / FADE_MS; fading = true; }
      paint(s, a);
    }
    if (cur) paint(cur, 1);
    ctx.globalAlpha = 1;
    if (fading) schedule(); // keep animating only while something is fading
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(redraw); };

  function setTool(t) {
    tool = t;
    root.querySelectorAll("[data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    const passThrough = t === "mouse" || t === "spot";
    cv.style.pointerEvents = passThrough ? "none" : "auto";
    cv.style.cursor = passThrough ? "" : "crosshair";
    spot.style.display = t === "spot" ? "block" : "none";
  }

  // drawing
  cv.addEventListener("pointerdown", (e) => {
    cv.setPointerCapture(e.pointerId);
    cur = { t: tool, c: color, x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY, p: [[e.clientX, e.clientY]] };
    schedule();
  });
  cv.addEventListener("pointermove", (e) => {
    if (!cur) return;
    cur.x2 = e.clientX; cur.y2 = e.clientY;
    if (cur.t === "pen" || cur.t === "marker") cur.p.push([e.clientX, e.clientY]);
    schedule();
  });
  cv.addEventListener("pointerup", () => {
    if (!cur) return;
    if (fade) cur.end = performance.now();
    shapes.push(cur);
    cur = null;
    schedule();
  });

  // cursor halo + spotlight follow the mouse (only when switched on)
  function onMove(e) {
    if (haloOn) { halo.style.left = e.clientX + "px"; halo.style.top = e.clientY + "px"; }
    if (tool === "spot") spot.style.background = `radial-gradient(circle 110px at ${e.clientX}px ${e.clientY}px, transparent 98%, rgba(0,0,0,.6) 100%)`;
  }
  document.addEventListener("pointermove", onMove, true);

  function onKey(e) {
    if (e.target !== document.body && e.target.closest && e.target.closest("input,textarea,[contenteditable]")) return;
    if (e.key === "Escape") return close();
    const k = { 1: "mouse", 2: "pen", 3: "marker", 4: "arrow", 5: "rect", 6: "spot" }[e.key];
    if (k) setTool(k);
    if (e.key.toLowerCase() === "c" && !e.ctrlKey && !e.metaKey) { shapes = []; schedule(); }
  }
  document.addEventListener("keydown", onKey, true);

  root.querySelector(".bar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-t],[data-c],[data-a]");
    if (!b) return;
    if (b.dataset.t) setTool(b.dataset.t);
    if (b.dataset.c) {
      color = b.dataset.c;
      root.querySelectorAll(".sw").forEach((s) => s.classList.toggle("on", s === b));
      if (tool === "mouse" || tool === "spot") setTool("pen");
    }
    if (b.dataset.a === "clear") { shapes = []; schedule(); }
    if (b.dataset.a === "fade") { fade = !fade; b.classList.toggle("on", fade); }
    if (b.dataset.a === "halo") { haloOn = !haloOn; b.classList.toggle("on", haloOn); halo.style.display = haloOn ? "block" : "none"; }
    if (b.dataset.a === "close") close();
  });

  function close() {
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("keydown", onKey, true);
    removeEventListener("resize", size);
    cancelAnimationFrame(raf);
    host.remove();
    delete window.__reelDraw;
  }
  window.__reelDraw = close;

  addEventListener("resize", size);
  root.querySelector(".sw").classList.add("on");
  setTool("pen");
  size();
})();
