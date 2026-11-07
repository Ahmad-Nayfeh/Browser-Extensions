// Reel – recorder page.
// Flow: settings → (choose area) → recording → result (trim + save).
const $ = (id) => document.getElementById(id);
const show = (id) => ["setup", "areaView", "recView", "editView"].forEach((s) => ($(s).hidden = s !== id));

const DEFAULTS = { quality: "1080", fps: "30", area: false, countdown: true, sysAudio: true, mic: true, micId: "", cam: false, camId: "", camPos: "br", camSize: "0.25" };
const FIELDS = Object.keys(DEFAULTS);
let S = { ...DEFAULTS };

// ---------- settings ----------
async function loadSettings() {
  S = { ...DEFAULTS, ...(await chrome.storage.local.get("settings")).settings };
  for (const k of FIELDS) {
    const el = $(k);
    if (el.type === "checkbox") el.checked = S[k];
    else el.value = S[k];
  }
  updateDeviceBoxes();
}
function saveSettings() {
  for (const k of FIELDS) { const el = $(k); S[k] = el.type === "checkbox" ? el.checked : el.value; }
  chrome.storage.local.set({ settings: S });
}
function updateDeviceBoxes() {
  $("micId").hidden = !$("mic").checked;
  $("camId").hidden = $("camPos").parentElement.parentElement.hidden = !$("cam").checked;
}
for (const k of FIELDS) $(k).addEventListener("change", () => { saveSettings(); updateDeviceBoxes(); if (k === "mic" || k === "cam") listDevices(true); });

// device names are only visible after permission was given once
async function listDevices(ask = false) {
  try {
    if (ask && ($("mic").checked || $("cam").checked)) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: $("mic").checked, video: $("cam").checked });
      s.getTracks().forEach((t) => t.stop());
    }
    const devs = await navigator.mediaDevices.enumerateDevices();
    for (const [box, kind] of [["micId", "audioinput"], ["camId", "videoinput"]]) {
      const sel = $(box);
      const keep = S[box];
      sel.innerHTML = `<option value="">Default ${kind === "audioinput" ? "microphone" : "camera"}</option>`;
      devs.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "default" && d.label).forEach((d) => {
        const o = document.createElement("option");
        o.value = d.deviceId; o.textContent = d.label; sel.append(o);
      });
      sel.value = [...sel.options].some((o) => o.value === keep) ? keep : "";
    }
  } catch (e) {
    $("setupMsg").textContent = "Microphone / camera permission was not given (" + e.name + "). You can still record the screen.";
  }
}

// ---------- recording state ----------
let display = null, mic = null, cam = null, worker = null, audioCtx = null, micGain = null;
let recorder = null, mime = "", startedAt = 0, pausedTotal = 0, pausedAt = 0, timer = null, pip = null;
let finished = false;
let writes = Promise.resolve(); // pending disk writes – wait for them before reading the recording

const TYPES = [
  "video/mp4;codecs=avc3,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
const pickType = () => TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || "";
const ext = (type) => (type.startsWith("video/mp4") ? "mp4" : "webm");
const bitrate = () => {
  const base = { 720: 2.5e6, 1080: 5e6, 1440: 8e6, 0: 8e6 }[S.quality] || 5e6;
  return Math.round(base * (S.fps === "60" ? 1.5 : S.fps === "15" ? 0.6 : 1));
};

function stopAll() {
  for (const s of [display, mic, cam]) if (s) s.getTracks().forEach((t) => t.stop());
  display = mic = cam = null;
  if (worker) { worker.terminate(); worker = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  clearInterval(timer);
  if (pip) { try { pip.close(); } catch {} pip = null; }
  chrome.runtime.sendMessage({ type: "badge", text: "" });
}

// ---------- floating controls (stay on top of every app) ----------
function openPipControls() {
  if (!("documentPictureInPicture" in window)) return Promise.resolve(null);
  return documentPictureInPicture.requestWindow({ width: 330, height: 64 }).then((w) => {
    w.document.head.innerHTML = `<style>
      body{margin:0;display:flex;align-items:center;gap:6px;padding:10px;background:#18181b;color:#f4f4f5;font:600 14px system-ui,sans-serif}
      b{color:#ef4444;margin-right:2px} #t{min-width:52px;font-variant-numeric:tabular-nums}
      button{font:inherit;font-size:12px;border:1px solid #3f3f46;background:#27272a;color:#f4f4f5;border-radius:7px;padding:6px 8px;cursor:pointer}
      button.stop{background:#dc2626;border-color:#dc2626}</style>`;
    w.document.body.innerHTML = `<b>●</b><span id="t">--:--</span>
      <button id="p">Pause</button><button id="d">Draw</button><button id="m">Mic</button><button id="s" class="stop">Stop</button>`;
    const d = w.document;
    d.getElementById("p").onclick = togglePause;
    d.getElementById("d").onclick = drawOnPage;
    d.getElementById("m").onclick = toggleMic;
    d.getElementById("s").onclick = stop;
    w.addEventListener("pagehide", () => { pip = null; });
    return w;
  }).catch(() => null);
}

function setPip(id, text) { if (pip) { const el = pip.document.getElementById(id); if (el) el.textContent = text; } }

// ---------- choose an area ----------
function pickArea(stream) {
  return new Promise((resolve) => {
    show("areaView");
    const v = $("preview");
    v.srcObject = stream;
    const box = $("previewBox"), sel = $("areaSel");
    let crop = null, start = null;
    const rel = (e) => { const r = v.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    const draw = () => {
      if (!crop) { sel.hidden = true; $("areaInfo").textContent = "Whole picture (drag to choose an area)"; return; }
      Object.assign(sel.style, { left: crop.x * 100 + "%", top: crop.y * 100 + "%", width: crop.w * 100 + "%", height: crop.h * 100 + "%" });
      sel.hidden = false;
      const vw = v.videoWidth, vh = v.videoHeight;
      $("areaInfo").textContent = `Area: ${Math.round(crop.w * vw)} × ${Math.round(crop.h * vh)} px`;
    };
    box.onmousedown = (e) => { start = rel(e); crop = null; draw(); };
    window.onmousemove = (e) => {
      if (!start) return;
      const [x, y] = rel(e);
      crop = { x: Math.min(x, start[0]), y: Math.min(y, start[1]), w: Math.abs(x - start[0]), h: Math.abs(y - start[1]) };
      if (crop.w < 0.02 || crop.h < 0.02) crop = null;
      draw();
    };
    window.onmouseup = () => { start = null; };
    draw();
    $("areaGo").onclick = () => { v.srcObject = null; resolve(crop || "full"); };
    $("areaCancel").onclick = () => { v.srcObject = null; resolve(null); };
  });
}

// ---------- build the streams ----------
function composite(screenTrack, camTrack, crop) {
  worker = new Worker("compositor.js");
  const screen = new MediaStreamTrackProcessor({ track: screenTrack }).readable;
  const gen = new MediaStreamTrackGenerator({ kind: "video" });
  const msg = { screen, output: gen.writable, crop, camPos: S.camPos, camSize: +S.camSize };
  const transfer = [screen, gen.writable];
  if (camTrack) {
    msg.camera = new MediaStreamTrackProcessor({ track: camTrack }).readable;
    transfer.push(msg.camera);
  }
  worker.postMessage(msg, transfer);
  return gen;
}

function mixAudio(streams) {
  const withAudio = streams.filter((s) => s && s.getAudioTracks().length);
  if (!withAudio.length) return null;
  audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  for (const s of withAudio) {
    const src = audioCtx.createMediaStreamSource(new MediaStream(s.getAudioTracks()));
    if (s === mic) { micGain = audioCtx.createGain(); src.connect(micGain).connect(dest); }
    else src.connect(dest);
  }
  return dest.stream.getAudioTracks()[0];
}

async function countdown() {
  if (!S.countdown) return;
  for (let i = 3; i > 0; i--) {
    setPip("t", `in ${i}…`);
    $("recTime").textContent = `in ${i}…`;
    chrome.runtime.sendMessage({ type: "badge", text: String(i) });
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ---------- start ----------
async function start() {
  saveSettings();
  $("setupMsg").textContent = "";
  finished = false;
  pip = await openPipControls(); // must happen right after the click

  const h = +S.quality;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: +S.fps, max: +S.fps }, ...(h ? { height: { ideal: h, max: h } } : {}) },
      audio: S.sysAudio ? { suppressLocalAudioPlayback: false } : false,
      systemAudio: S.sysAudio ? "include" : "exclude",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      monitorTypeSurfaces: "include",
    });
  } catch (e) {
    stopAll();
    $("setupMsg").textContent = e.name === "NotAllowedError" ? "Cancelled." : "Could not start: " + e.message;
    return;
  }

  try {
    if (S.mic) mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: S.micId || undefined, echoCancellation: true, noiseSuppression: true } });
  } catch { $("setupMsg").textContent = "Microphone not available – recording without it."; }
  try {
    if (S.cam) cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: S.camId || undefined, width: { ideal: 640 }, height: { ideal: 480 } } });
  } catch { $("setupMsg").textContent = "Camera not available – recording without it."; }

  let crop = null;
  if (S.area) {
    const r = await pickArea(display);
    if (!r) { stopAll(); show("setup"); return; }
    crop = r === "full" ? null : r;
  }

  const screenTrack = display.getVideoTracks()[0];
  screenTrack.addEventListener("ended", stop); // Chrome's own "Stop sharing" button
  let videoTrack = screenTrack;
  if (crop || cam) {
    try { videoTrack = composite(screenTrack, cam && cam.getVideoTracks()[0], crop); }
    catch (e) { $("setupMsg").textContent = "Camera/area not supported here – recording plain screen."; videoTrack = screenTrack; }
  }
  const audioTrack = mixAudio([display, mic]);
  const stream = new MediaStream([videoTrack, ...(audioTrack ? [audioTrack] : [])]);

  show("recView");
  document.body.classList.remove("paused");
  $("micBtn").hidden = !mic;
  if (pip && !mic) pip.document.getElementById("m").hidden = true;
  await countdown();

  await Chunks.clear();
  mime = pickType();
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate(), audioBitsPerSecond: 128000 });
  writes = Promise.resolve();
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) writes = writes.then(() => Chunks.add(e.data)); };
  recorder.onstop = finish;
  recorder.start(1000); // a piece every second → written to disk
  await Chunks.setMeta({ mime, date: Date.now(), done: false });
  startedAt = Date.now(); pausedTotal = 0; pausedAt = 0;
  tick();
  timer = setInterval(tick, 500);
}

function elapsed() { return (pausedAt || Date.now()) - startedAt - pausedTotal; }
const fmt = (ms) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0"); const ss = String(s % 60).padStart(2, "0"); return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`; };
function tick() {
  const t = fmt(elapsed());
  $("recTime").textContent = t;
  setPip("t", t);
  document.title = `● ${t} – Reel`;
  chrome.runtime.sendMessage({ type: "badge", text: pausedAt ? "❚❚" : "REC" });
}

function togglePause() {
  if (!recorder) return;
  if (recorder.state === "recording") { recorder.pause(); pausedAt = Date.now(); }
  else if (recorder.state === "paused") { recorder.resume(); pausedTotal += Date.now() - pausedAt; pausedAt = 0; }
  const paused = recorder.state === "paused";
  $("pauseBtn").textContent = paused ? "Resume" : "Pause";
  setPip("p", paused ? "Resume" : "Pause");
  document.body.classList.toggle("paused", paused);
  tick();
}

function toggleMic() {
  if (!micGain) return;
  const muted = micGain.gain.value === 0;
  micGain.gain.value = muted ? 1 : 0;
  $("micBtn").textContent = muted ? "Mute mic" : "Unmute mic";
  setPip("m", muted ? "Mic" : "Mic off");
}

async function drawOnPage() {
  const ok = await chrome.runtime.sendMessage({ type: "draw" });
  if (!ok) $("recInfo").textContent = "Drawing works on normal web pages only (not on other apps or chrome:// pages).";
}

function stop() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
  else stopAll();
}

// ---------- result ----------
let resultBlob = null, duration = 0;

async function finish() {
  if (finished) return;
  finished = true;
  stopAll();
  document.title = "Reel – Screen Recorder";
  await writes;
  const meta = (await Chunks.getMeta()) || {};
  await Chunks.setMeta({ ...meta, done: true });
  await openResult();
  chrome.tabs.getCurrent((t) => t && chrome.tabs.update(t.id, { active: true }));
}

async function openResult() {
  const meta = (await Chunks.getMeta()) || {};
  const parts = await Chunks.all();
  if (!parts.length) { show("setup"); $("setupMsg").textContent = "Nothing was recorded."; return; }
  mime = meta.mime || parts[0].type;
  resultBlob = new Blob(parts, { type: mime.split(";")[0] });
  show("editView");
  const v = $("result");
  v.src = URL.createObjectURL(resultBlob);
  await new Promise((r) => (v.onloadedmetadata = r));
  // recordings often don't store their length; this trick makes the browser find it
  if (!Number.isFinite(v.duration)) {
    await new Promise((r) => { v.ondurationchange = () => { if (Number.isFinite(v.duration)) r(); }; v.currentTime = 1e101; });
    v.currentTime = 0;
  }
  duration = v.duration;
  if (ext(mime) === "webm") resultBlob = await fixWebmDuration(resultBlob, duration * 1000);
  for (const id of ["trimStart", "trimEnd"]) $(id).max = duration.toFixed(1);
  $("trimStart").value = 0;
  $("trimEnd").value = duration.toFixed(1);
  $("editInfo").textContent = `${fmt(duration * 1000)} · ${(resultBlob.size / 1048576).toFixed(1)} MB · ${ext(mime).toUpperCase()}`;
  updateTrim();
}

function trimRange() {
  let a = +$("trimStart").value, b = +$("trimEnd").value;
  if (a > b) [a, b] = [b, a];
  return [a, b];
}
function updateTrim() {
  const [a, b] = trimRange();
  const cut = a > 0.05 || b < duration - 0.05;
  $("trimInfo").textContent = cut ? `${fmt(a * 1000)} → ${fmt(b * 1000)} (${fmt((b - a) * 1000)})` : "Whole video";
  $("saveBtn").textContent = cut ? "Save trimmed video" : "Save video";
}
$("trimStart").oninput = () => { updateTrim(); $("result").currentTime = trimRange()[0]; };
$("trimEnd").oninput = () => { updateTrim(); $("result").currentTime = trimRange()[1]; };
$("setStart").onclick = () => { $("trimStart").value = $("result").currentTime; updateTrim(); };
$("setEnd").onclick = () => { $("trimEnd").value = $("result").currentTime; updateTrim(); };
$("playSel").onclick = () => {
  const v = $("result"), [a, b] = trimRange();
  v.currentTime = a; v.play();
  const stopAt = () => { if (v.currentTime >= b) { v.pause(); v.removeEventListener("timeupdate", stopAt); } };
  v.addEventListener("timeupdate", stopAt);
};

function fileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `Recording ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}.${ext(mime)}`;
}
function download(blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// Trimming without a heavy video library: the chosen part is played once
// (silently) and recorded again. It takes as long as the part itself.
async function exportTrimmed(a, b) {
  const v = document.createElement("video");
  v.src = $("result").src;
  v.playsInline = true;
  await new Promise((r) => (v.onloadedmetadata = r));
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  ac.createMediaElementSource(v).connect(dest); // to the recording only, not the speakers
  v.currentTime = a;
  await new Promise((r) => (v.onseeked = r));
  const vs = v.captureStream();
  const stream = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const parts = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate() });
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  $("progress").hidden = false;
  await v.play();
  rec.start(1000);
  await new Promise((r) => {
    const t = () => {
      $("progress").value = Math.min(1, (v.currentTime - a) / (b - a));
      $("saveMsg").textContent = `Preparing… ${Math.round($("progress").value * 100)}% (keep this tab open)`;
      if (v.currentTime >= b || v.ended) { v.removeEventListener("timeupdate", t); r(); }
    };
    v.addEventListener("timeupdate", t);
  });
  rec.stop();
  v.pause();
  await done;
  ac.close();
  $("progress").hidden = true;
  const out = new Blob(parts, { type: mime.split(";")[0] });
  return ext(mime) === "webm" ? fixWebmDuration(out, (b - a) * 1000) : out;
}

$("saveBtn").onclick = async () => {
  const [a, b] = trimRange();
  const cut = a > 0.05 || b < duration - 0.05;
  $("saveBtn").disabled = true;
  try {
    download(cut ? await exportTrimmed(a, b) : resultBlob);
    $("saveMsg").textContent = "Saved to your Downloads folder ✓";
  } catch (e) {
    $("saveMsg").textContent = "Could not save: " + e.message;
  }
  $("saveBtn").disabled = false;
};
$("newBtn").onclick = () => { $("result").pause(); show("setup"); checkRecover(); };
$("discardBtn").onclick = async () => {
  if (!confirm("Delete this recording? This can't be undone.")) return;
  $("result").pause();
  await Chunks.clear();
  resultBlob = null;
  show("setup");
  checkRecover();
};

// ---------- controls ----------
$("start").onclick = start;
$("stopBtn").onclick = stop;
$("pauseBtn").onclick = togglePause;
$("micBtn").onclick = toggleMic;
$("drawBtn").onclick = drawOnPage;
$("recoverBtn").onclick = openResult;
chrome.runtime.onMessage.addListener((m) => { if (m.type === "shortcut" && recorder && recorder.state !== "inactive") stop(); });
window.addEventListener("beforeunload", (e) => { if (recorder && recorder.state !== "inactive") { e.preventDefault(); e.returnValue = ""; } });

async function checkRecover() {
  const meta = await Chunks.getMeta();
  $("recover").hidden = !meta;
}

loadSettings().then(() => listDevices(false));
checkRecover();
show("setup");
