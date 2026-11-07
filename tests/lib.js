// Shared helpers for the extension tests.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const EXT = path.join(ROOT, "extensions");
const FIX = path.join(__dirname, "fixtures");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Extension id from the "key" in manifest.json (the same in every copy of the folder)
function idOf(name) {
  const m = JSON.parse(fs.readFileSync(path.join(EXT, name, "manifest.json"), "utf8"));
  const hash = crypto.createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex");
  return [...hash.slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

// A temporary copy of an extension, changed for testing:
//  openShadow – closed shadow roots become open, so the test can click inside them
//  permissions / hosts – extra permissions standing in for "you clicked the icon" (activeTab)
function prepare(name, { openShadow = false, permissions = [], hosts = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ext-${name}-`));
  fs.cpSync(path.join(EXT, name), dir, { recursive: true });
  fs.rmSync(path.join(dir, "_metadata"), { recursive: true, force: true });
  const mf = path.join(dir, "manifest.json");
  const m = JSON.parse(fs.readFileSync(mf, "utf8"));
  m.permissions = [...new Set([...(m.permissions || []), ...permissions])];
  if (hosts.length) m.host_permissions = [...new Set([...(m.host_permissions || []), ...hosts])];
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  if (openShadow) {
    for (const f of walk(dir)) if (f.endsWith(".js")) {
      const s = fs.readFileSync(f, "utf8");
      if (s.includes('mode: "closed"')) fs.writeFileSync(f, s.replace(/mode: "closed"/g, 'mode: "open"'));
    }
  }
  return dir;
}
function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])); }

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

// Start Chromium with some extensions. `exts` = folder names or { name, dir } from prepare().
async function launch(exts, { headful = false, args = [], viewport = { width: 1280, height: 800 } } = {}) {
  const list = exts.map((e) => (typeof e === "string" ? { name: e, dir: path.join(EXT, e) } : e));
  const dirs = list.map((e) => e.dir).join(",");
  const ctx = await chromium.launchPersistentContext("", {
    channel: "chromium", headless: !headful, ignoreHTTPSErrors: true, proxy, viewport, acceptDownloads: true,
    args: [...(list.length ? [`--disable-extensions-except=${dirs}`, `--load-extension=${dirs}`] : []), ...args],
  });
  const ids = Object.fromEntries(list.map((e) => [e.name, idOf(e.name)]));
  const workers = {};
  const want = list.filter((e) => JSON.parse(fs.readFileSync(path.join(e.dir, "manifest.json"))).background);
  for (let i = 0; i < 60 && Object.keys(workers).length < want.length; i++) {
    for (const w of ctx.serviceWorkers()) for (const e of want) if (w.url().includes(ids[e.name])) workers[e.name] = w;
    if (Object.keys(workers).length < want.length) await sleep(200);
  }
  const url = (name, p) => `chrome-extension://${ids[name]}/${p}`;
  // an extension page, opened as a normal tab
  const page = async (name, p) => { const pg = await ctx.newPage(); await pg.goto(url(name, p)); return pg; };
  // open the popup page but make it believe `tab` is the current tab (the popup normally
  // belongs to the tab you clicked the icon on)
  const popup = async (name, p, tab) => {
    const pg = await ctx.newPage();
    await pg.addInitScript((t) => { const q = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = async (o) => (o && o.active ? [t] : q(o)); }, tab);
    await pg.goto(url(name, p));
    return pg;
  };
  const tabOf = (w, host) => w.evaluate(async (h) => (await chrome.tabs.query({})).find((t) => (t.url || "").includes(h)), host);
  return { ctx, workers, ids, url, page, popup, tabOf, close: () => ctx.close() };
}

// Fake websites: `routes` maps "host/path" (or "host/*") to HTML or (url, request) => response.
// Every other request gets an empty 200, so tests never depend on the internet.
async function site(ctx, routes) {
  await ctx.route("**/*", async (r) => {
    // only web requests – the extensions' own files (chrome-extension://) must load normally
    if (!/^https?:/.test(r.request().url())) return r.fallback();
    const u = new URL(r.request().url());
    const key = u.host + u.pathname;
    const handler = routes[key] ?? routes[u.host + "/*"];
    if (handler === undefined) return r.fulfill({ status: 200, body: "" });
    const res = typeof handler === "function" ? await handler(u, r.request()) : handler;
    if (typeof res === "string") return r.fulfill({ contentType: "text/html; charset=utf-8", body: res });
    return r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", ...res });
  });
}
const html = (title, body, head = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;

// Raw DevTools connection to one extension's worker without attaching to any tab.
// (Playwright attaches to tabs, and some Chrome features – tab discarding – crash then.)
async function rawWorker(name, code) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "prof-"));
  const dir = path.join(EXT, name);
  const p = spawn(chromium.executablePath(), [
    "--headless", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${prof}`,
    `--disable-extensions-except=${dir}`, `--load-extension=${dir}`, "--no-first-run",
    "--disable-features=DisableLoadExtensionCommandLineSwitch", "--disable-component-extensions-with-background-pages",
    ...(proxy ? [`--proxy-server=${proxy.server}`, "--ignore-certificate-errors"] : []), "about:blank",
  ], { stdio: "ignore" });
  try {
    let port = null;
    for (let i = 0; i < 50 && !port; i++) { await sleep(200); try { port = fs.readFileSync(path.join(prof, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch {} }
    const id = idOf(name);
    let t = null;
    for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === "service_worker" && x.url.includes(id)); } catch {} }
    if (!t) throw new Error("extension worker did not start");
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    const res = await new Promise((resolve) => {
      ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d.result); };
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: code, awaitPromise: true, returnByValue: true } }));
    });
    ws.close();
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception ? res.exceptionDetails.exception.description : "error in worker");
    return res.result.value;
  } finally { p.kill(); }
}

// Read a ZIP file (stored or deflated) → { name: Buffer }
function readZip(buf) {
  const zlib = require("zlib");
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip directory");
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    const lh = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.slice(lh, lh + size);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nameLen + extra + comment;
  }
  return files;
}

async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  return { name: dl.suggestedFilename(), data: fs.readFileSync(await dl.path()) };
}

module.exports = { ROOT, EXT, FIX, sleep, idOf, prepare, launch, site, html, rawWorker, readZip, download };
