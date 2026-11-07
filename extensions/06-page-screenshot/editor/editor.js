// Snap editor. The screenshot is drawn once into <canvas>; while you drag,
// the shape preview is a lightweight SVG overlay, and the big canvas is only
// redrawn when you release the mouse. That keeps huge full-page shots smooth.

const $ = (id) => document.getElementById(id);
const cv = $("cv");
const ctx = cv.getContext("2d");
const params = new URLSearchParams(location.search);

let img = null;          // the original screenshot
let meta = {};           // title/url of the page
let crop = null;         // {x,y,w,h} in image pixels
let items = [];          // annotations, in image pixels
let history = [];        // snapshots for undo
let tool = params.get("crop") === "1" ? "crop" : "rect";

// ---------- SVG overlay for previews ----------
const NS = "http://www.w3.org/2000/svg";
const svg = document.createElementNS(NS, "svg");
svg.style.cssText = "position:absolute;pointer-events:none;overflow:visible";
$("stage").appendChild(svg);

function placeOverlay() {
  const r = cv.getBoundingClientRect();
  const s = $("stage").getBoundingClientRect();
  Object.assign(svg.style, { left: r.left - s.left + "px", top: r.top - s.top + "px", width: r.width + "px", height: r.height + "px" });
  svg.setAttribute("viewBox", `0 0 ${cv.width} ${cv.height}`);
}
window.addEventListener("resize", placeOverlay);

// ---------- drawing ----------
function drawArrow(c, x1, y1, x2, y2, w) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const head = 6 + w * 3;
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2 - Math.cos(a) * head * 0.6, y2 - Math.sin(a) * head * 0.6);
  c.stroke();
  c.beginPath();
  c.moveTo(x2, y2);
  c.lineTo(x2 - head * Math.cos(a - 0.45), y2 - head * Math.sin(a - 0.45));
  c.lineTo(x2 - head * Math.cos(a + 0.45), y2 - head * Math.sin(a + 0.45));
  c.closePath();
  c.fill();
}

function norm(r) {
  return { x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2), w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) };
}

function render() {
  cv.width = crop.w;
  cv.height = crop.h;
  ctx.save();
  ctx.translate(-crop.x, -crop.y);
  ctx.drawImage(img, 0, 0);
  for (const it of items) {
    ctx.strokeStyle = ctx.fillStyle = it.color;
    ctx.lineWidth = it.width;
    ctx.lineCap = ctx.lineJoin = "round";
    if (it.type === "rect") { const r = norm(it); ctx.strokeRect(r.x, r.y, r.w, r.h); }
    else if (it.type === "arrow") drawArrow(ctx, it.x1, it.y1, it.x2, it.y2, it.width);
    else if (it.type === "pen") {
      ctx.beginPath();
      it.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    } else if (it.type === "text") {
      ctx.font = `600 ${it.size}px system-ui, sans-serif`;
      ctx.textBaseline = "top";
      it.text.split("\n").forEach((line, i) => ctx.fillText(line, it.x, it.y + i * it.size * 1.25));
    } else if (it.type === "highlight") {
      const r = norm(it);
      ctx.globalAlpha = 0.35;
      ctx.globalCompositeOperation = "multiply";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    } else if (it.type === "blur") {
      const r = norm(it);
      if (r.w < 2 || r.h < 2) continue;
      const k = Math.max(6, Math.round(Math.min(r.w, r.h) / 12)); // pixel block size
      const t = new OffscreenCanvas(Math.max(1, Math.round(r.w / k)), Math.max(1, Math.round(r.h / k)));
      t.getContext("2d").drawImage(img, r.x, r.y, r.w, r.h, 0, 0, t.width, t.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(t, 0, 0, t.width, t.height, r.x, r.y, r.w, r.h);
      ctx.imageSmoothingEnabled = true;
    }
  }
  ctx.restore();
  $("info").textContent = `${crop.w} × ${crop.h} px · ${meta.title || ""}${meta.cut ? " · page was very long and was cut at 30 000 px" : ""}`;
  requestAnimationFrame(placeOverlay);
}

function snapshot() { history.push(JSON.stringify({ crop, items })); if (history.length > 50) history.shift(); }
function undo() {
  const prev = history.pop();
  if (!prev) return;
  ({ crop, items } = JSON.parse(prev));
  render();
}

// ---------- mouse ----------
function toImage(e) {
  const r = cv.getBoundingClientRect();
  return [
    Math.round((e.clientX - r.left) * (cv.width / r.width) + crop.x),
    Math.round((e.clientY - r.top) * (cv.height / r.height) + crop.y),
  ];
}

let drag = null;
const opt = () => ({ color: $("color").value, width: +$("width").value });

function preview() {
  svg.innerHTML = "";
  if (!drag) return;
  const c = opt();
  const ox = crop.x, oy = crop.y;
  let el;
  if (drag.type === "pen") {
    el = document.createElementNS(NS, "polyline");
    el.setAttribute("points", drag.points.map(([x, y]) => `${x - ox},${y - oy}`).join(" "));
    el.setAttribute("fill", "none");
  } else if (drag.type === "arrow") {
    el = document.createElementNS(NS, "line");
    el.setAttribute("x1", drag.x1 - ox); el.setAttribute("y1", drag.y1 - oy);
    el.setAttribute("x2", drag.x2 - ox); el.setAttribute("y2", drag.y2 - oy);
  } else {
    const r = norm(drag);
    el = document.createElementNS(NS, "rect");
    el.setAttribute("x", r.x - ox); el.setAttribute("y", r.y - oy);
    el.setAttribute("width", r.w); el.setAttribute("height", r.h);
    const fill = { crop: "rgba(37,99,235,.12)", highlight: c.color, blur: "rgba(128,128,128,.35)" }[drag.type] || "none";
    el.setAttribute("fill", fill);
    if (drag.type === "highlight") el.setAttribute("fill-opacity", ".35");
    if (drag.type === "crop") el.setAttribute("stroke-dasharray", "8 6");
  }
  el.setAttribute("stroke", drag.type === "crop" ? "#2563eb" : c.color);
  el.setAttribute("stroke-width", drag.type === "crop" ? 2 * (cv.width / cv.getBoundingClientRect().width) : c.width);
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  svg.appendChild(el);
}

cv.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const [x, y] = toImage(e);
  if (tool === "text") {
    const text = prompt("Text:");
    if (text) { snapshot(); items.push({ type: "text", x, y, text, ...opt(), size: 10 + opt().width * 4 }); render(); }
    return;
  }
  drag = { type: tool, x1: x, y1: y, x2: x, y2: y, points: [[x, y]], ...opt() };
  preview();
});
window.addEventListener("mousemove", (e) => {
  if (!drag) return;
  const [x, y] = toImage(e);
  drag.x2 = x; drag.y2 = y;
  if (drag.type === "pen") drag.points.push([x, y]);
  preview();
});
window.addEventListener("mouseup", () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  svg.innerHTML = "";
  const r = norm(d);
  if (d.type !== "pen" && r.w < 3 && r.h < 3) return; // just a click
  snapshot();
  if (d.type === "crop") {
    const x = Math.max(crop.x, r.x), y = Math.max(crop.y, r.y);
    const x2 = Math.min(crop.x + crop.w, r.x + r.w), y2 = Math.min(crop.y + crop.h, r.y + r.h);
    if (x2 - x > 2 && y2 - y > 2) crop = { x, y, w: x2 - x, h: y2 - y };
    setTool("rect");
  } else {
    if (d.type !== "pen") delete d.points;
    items.push(d);
  }
  render();
});

// ---------- toolbar ----------
function setTool(t) {
  tool = t;
  document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
  cv.style.cursor = t === "text" ? "text" : "crosshair";
}
document.querySelectorAll("[data-tool]").forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
$("undo").onclick = undo;

const KEYS = { c: "crop", r: "rect", a: "arrow", p: "pen", t: "text", h: "highlight", b: "blur" };
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input,select")) return;
  if (KEYS[e.key.toLowerCase()]) setTool(KEYS[e.key.toLowerCase()]);
});

// ---------- export ----------
function fileName(ext) {
  const t = (meta.title || "screenshot").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80);
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${t} ${stamp}.${ext}`;
}
const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = old), 1500);
}

$("png").onclick = async () => download(await toBlob(cv, "image/png"), fileName("png"));
$("jpg").onclick = async () => {
  // JPG has no transparency: paint white below
  const t = document.createElement("canvas");
  t.width = cv.width; t.height = cv.height;
  const c = t.getContext("2d");
  c.fillStyle = "#fff"; c.fillRect(0, 0, t.width, t.height); c.drawImage(cv, 0, 0);
  download(await toBlob(t, "image/jpeg", 0.92), fileName("jpg"));
};
$("pdf").onclick = async () => {
  const pageH = Math.round(cv.width * 1.414); // A4 proportions
  const pages = [];
  for (let y = 0; y < cv.height; y += pageH) {
    const h = Math.min(pageH, cv.height - y);
    const t = document.createElement("canvas");
    t.width = cv.width; t.height = h;
    const c = t.getContext("2d");
    c.fillStyle = "#fff"; c.fillRect(0, 0, t.width, h);
    c.drawImage(cv, 0, y, cv.width, h, 0, 0, cv.width, h);
    const blob = await toBlob(t, "image/jpeg", 0.9);
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), w: t.width, h });
  }
  download(makePdf(pages), fileName("pdf"));
};
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": toBlob(cv, "image/png") })]);
    flash($("copy"), "Copied ✓");
  } catch (e) { flash($("copy"), "Copy failed"); }
};

// ---------- load ----------
(async () => {
  const shot = await ShotDB.get(params.get("id"));
  if (!shot) { $("info").textContent = "Screenshot not found (it is replaced by the next capture)."; return; }
  meta = shot;
  document.title = "Snap – " + (shot.title || "screenshot");
  img = new Image();
  img.src = shot.dataUrl;
  await img.decode();
  crop = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  setTool(tool);
  render();
})();
