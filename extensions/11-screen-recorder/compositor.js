// Runs in a Web Worker: browsers don't slow workers down when the tab is in
// the background, so the video keeps its frame rate while you use other apps.
// For each screen frame: crop it (optional) and draw the camera bubble (optional).
let camFrame = null;

async function readCamera(readable) {
  const reader = readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    if (camFrame) camFrame.close();
    camFrame = value; // keep only the newest camera picture
  }
}

function drawCamera(ctx, W, H, pos, size) {
  const d = Math.round(Math.min(W, H) * size);
  const m = Math.round(Math.min(W, H) * 0.03);
  const x = pos.includes("r") ? W - d - m : m;
  const y = pos.includes("b") ? H - d - m : m;
  const fw = camFrame.displayWidth, fh = camFrame.displayHeight;
  const s = Math.min(fw, fh); // square from the middle of the camera picture
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
  ctx.clip();
  // mirror, like looking in a mirror
  ctx.translate(x + d, y);
  ctx.scale(-1, 1);
  ctx.drawImage(camFrame, (fw - s) / 2, (fh - s) / 2, s, s, 0, 0, d, d);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2, d * 0.02);
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.stroke();
}

onmessage = async ({ data }) => {
  const { screen, camera, output, crop, camPos, camSize } = data;
  if (camera) readCamera(camera);
  const reader = screen.getReader();
  const writer = output.getWriter();
  let canvas = null, ctx = null;
  for (;;) {
    const { value: frame, done } = await reader.read();
    if (done) break;
    const fw = frame.displayWidth, fh = frame.displayHeight;
    // crop is stored as fractions (0..1) so it survives a resolution change
    const c = crop
      ? { x: Math.round(crop.x * fw), y: Math.round(crop.y * fh), w: Math.round(crop.w * fw), h: Math.round(crop.h * fh) }
      : { x: 0, y: 0, w: fw, h: fh };
    const W = Math.max(2, c.w & ~1), H = Math.max(2, c.h & ~1); // encoders want even sizes
    if (!canvas || canvas.width !== W || canvas.height !== H) {
      canvas = new OffscreenCanvas(W, H);
      ctx = canvas.getContext("2d", { alpha: false });
    }
    ctx.drawImage(frame, c.x, c.y, W, H, 0, 0, W, H);
    if (camFrame) drawCamera(ctx, W, H, camPos, camSize);
    const out = new VideoFrame(canvas, { timestamp: frame.timestamp });
    frame.close();
    try { await writer.write(out); } catch { out.close(); break; }
  }
  try { await writer.close(); } catch {}
};
