importScripts("idb.js");

// Runs in the page's own world for a moment: frameworks leave global
// variables and markup patterns that tell which technologies the site uses.
function detectTech() {
  const t = [];
  const d = document, w = window;
  const has = (sel) => !!d.querySelector(sel);
  const cls = d.documentElement.outerHTML.slice(0, 400000);
  if (w.__NEXT_DATA__ || w.__next_f || has("#__next") || has('script[src*="/_next/"]')) t.push("Next.js (React)");
  else if (w.__REACT_DEVTOOLS_GLOBAL_HOOK__ && w.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers && w.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.size || has("[data-reactroot]")) t.push("React");
  if (w.__NUXT__ || has("#__nuxt")) t.push("Nuxt (Vue)");
  else if (w.__VUE__ || has("[data-v-app]") || /data-v-[0-9a-f]{8}/.test(cls)) t.push("Vue");
  if (has("[ng-version]")) t.push("Angular " + d.querySelector("[ng-version]").getAttribute("ng-version"));
  if (/class="[^"]*svelte-[a-z0-9]+/.test(cls)) t.push("Svelte");
  if (w.Astro || has("astro-island")) t.push("Astro");
  if (w.jQuery) t.push("jQuery " + (w.jQuery.fn && w.jQuery.fn.jquery || ""));
  if (/wp-content|wp-includes/.test(cls)) t.push("WordPress");
  if (w.Shopify) t.push("Shopify");
  if (has("[data-wf-page]")) t.push("Webflow");
  if (/static\.wixstatic\.com/.test(cls)) t.push("Wix");
  if (/squarespace/.test(cls)) t.push("Squarespace");
  // CSS frameworks are recognised by the CSS variables they define, not by class names
  const rootVar = (v) => getComputedStyle(d.documentElement).getPropertyValue(v).trim() || getComputedStyle(d.body).getPropertyValue(v).trim();
  const styleText = [...d.querySelectorAll("style")].map((s) => s.textContent.slice(0, 300)).join(" ");
  const anyEl = d.querySelector("body *");
  const twVar = anyEl && getComputedStyle(anyEl).getPropertyValue("--tw-ring-offset-width").trim();
  if (twVar || /tailwindcss v\d/i.test(styleText) || has('link[href*="tailwind"]')) t.push("Tailwind CSS");
  if (rootVar("--bs-body-font-family") || rootVar("--bs-blue") || w.bootstrap || has('link[href*="bootstrap"]')) t.push("Bootstrap");
  if (has('link[href*="fonts.googleapis"]')) t.push("Google Fonts");
  if (has('[class*="fa-"], link[href*="fontawesome"], link[href*="font-awesome"]')) t.push("Font Awesome");
  if (w.gsap) t.push("GSAP (animations)");
  if (w.Swiper || has(".swiper")) t.push("Swiper (sliders)");
  if (w.gtag || w.dataLayer) t.push("Google Analytics / Tag Manager");
  const gen = d.querySelector('meta[name="generator"]');
  if (gen) t.push("generator: " + gen.content);
  return t;
}

// Scroll down the whole page step by step (pictures and sections that load
// late appear), then back to the top.
function autoScroll() {
  return new Promise((done) => {
    let y = 0, steps = 0;
    const tick = () => {
      y += innerHeight * 0.9;
      scrollTo(0, y);
      steps++;
      if (y < document.documentElement.scrollHeight - innerHeight && steps < 60) setTimeout(tick, 250);
      else setTimeout(() => { scrollTo(0, 0); setTimeout(done, 600); }, 500);
    };
    tick();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- one debugger session per run: network capture + screenshots ----------
class Session {
  constructor(tabId) { this.tabId = tabId; this.target = { tabId }; this.reqs = new Map(); this.done = []; this.pending = new Set(); this.page = ""; }
  send(m, p) { return chrome.debugger.sendCommand(this.target, m, p); }
  async start(api) {
    await chrome.debugger.attach(this.target, "1.3");
    this.listener = (src, method, params) => { if (src.tabId === this.tabId) this.onEvent(method, params); };
    chrome.debugger.onEvent.addListener(this.listener);
    if (api) await this.send("Network.enable", { maxResourceBufferSize: 5e6, maxTotalBufferSize: 5e7 });
  }
  onEvent(method, p) {
    if (method === "Network.requestWillBeSent" && (p.type === "XHR" || p.type === "Fetch")) {
      this.reqs.set(p.requestId, { page: this.page, method: p.request.method, url: p.request.url, post: p.request.postData || "", type: p.type });
      this.pending.add(p.requestId);
    } else if (method === "Network.responseReceived" && this.reqs.has(p.requestId)) {
      Object.assign(this.reqs.get(p.requestId), { status: p.response.status, mime: p.response.mimeType });
    } else if (method === "Network.loadingFinished" && this.reqs.has(p.requestId)) {
      this.pending.delete(p.requestId);
      const r = this.reqs.get(p.requestId);
      r.size = p.encodedDataLength;
      if (/json|text\/plain|graphql/.test(r.mime || "") && p.encodedDataLength < 400000) {
        this.send("Network.getResponseBody", { requestId: p.requestId }).then((b) => { r.body = b.base64Encoded ? "" : b.body; }).catch(() => {});
      }
      this.done.push(r);
    } else if (method === "Network.loadingFailed" && this.reqs.has(p.requestId)) {
      this.pending.delete(p.requestId);
      const r = this.reqs.get(p.requestId);
      r.status = 0; r.error = p.errorText;
      this.done.push(r);
    }
  }
  // wait until no data request has been running for 1.2 s (max 12 s)
  async idle() {
    const end = Date.now() + 12000;
    let quietSince = Date.now();
    while (Date.now() < end) {
      await sleep(200);
      if (this.pending.size) quietSince = Date.now();
      else if (Date.now() - quietSince > 1200) return;
    }
  }
  // the whole page, in parts of 8 000 px (one giant image fails in Chrome)
  async screenshot(maxHeight = 120000) {
    const { cssContentSize: s } = await this.send("Page.getLayoutMetrics");
    const W = Math.ceil(s.width), H = Math.min(Math.ceil(s.height), maxHeight);
    const parts = [];
    for (let y = 0; y < H; y += 8000) {
      const { data } = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y, width: W, height: Math.min(8000, H - y), scale: 1 } });
      parts.push("data:image/png;base64," + data);
    }
    return parts;
  }
  async stop() {
    if (this.listener) chrome.debugger.onEvent.removeListener(this.listener);
    await chrome.debugger.detach(this.target).catch(() => {});
  }
}

async function loadAndSettle(tabId, url, session) {
  await new Promise((resolve) => {
    const t = setTimeout(done, 30000);
    function done() { clearTimeout(t); chrome.tabs.onUpdated.removeListener(on); resolve(); }
    function on(id, info) { if (id === tabId && info.status === "complete") done(); }
    chrome.tabs.onUpdated.addListener(on);
    if (url) chrome.tabs.update(tabId, { url }); else chrome.tabs.reload(tabId);
  });
  await sleep(800);
  if (session) await session.idle();
}

// ---------- API section ----------
const SECRET_KEY = /token|password|passwd|secret|auth|session|cookie|api[-_]?key|credit|card|cvv|otp/i;
function mask(v, depth = 0) {
  if (depth > 8 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => mask(x, depth + 1));
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEY.test(k) ? "•••" : mask(x, depth + 1);
  return o;
}
function shape(v, depth = 0, indent = "") {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? `[ ${shape(v[0], depth + 1, indent)} ]  // ${v.length} items` : "[]";
  if (typeof v === "object") {
    if (depth > 5) return "{…}";
    const keys = Object.keys(v).slice(0, 40);
    const pad = indent + "  ";
    return "{\n" + keys.map((k) => `${pad}${k}: ${shape(v[k], depth + 1, pad)}`).join(",\n") + (Object.keys(v).length > 40 ? `,\n${pad}… ${Object.keys(v).length - 40} more` : "") + `\n${indent}}`;
  }
  if (typeof v === "string") return /^\d{4}-\d\d-\d\d/.test(v) ? "string (date)" : /^https?:\/\//.test(v) ? "string (url)" : /@.+\./.test(v) ? "string (email)" : "string";
  return typeof v;
}
const template = (url) => { try { const u = new URL(url); return u.origin + u.pathname.replace(/\/\d+(?=\/|$)/g, "/:id").replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/:uuid").replace(/\/[0-9a-f]{24}(?=\/|$)/g, "/:id"); } catch { return url; } };
const parseJSON = (s) => { try { return JSON.parse(s); } catch { return undefined; } };

function apiSection(reqs, siteOrigin) {
  if (!reqs.length) return "## 10. Data & API\n_No data requests (fetch/XHR) were made while the pages loaded – the content is in the HTML itself._";
  const groups = new Map();
  for (const r of reqs) {
    const k = `${r.method} ${template(r.url)}`;
    const g = groups.get(k) || { ...r, n: 0, statuses: new Set(), pages: new Set() };
    g.n++; g.statuses.add(r.status); g.pages.add(r.page);
    if (!g.body && r.body) g.body = r.body;
    if (!g.post && r.post) g.post = r.post;
    groups.set(k, g);
  }
  const short = (u) => (u.startsWith(siteOrigin) ? u.slice(siteOrigin.length) : u);
  const out = [`## 10. Data & API (what the site exchanges with its server)
> The server's own code never reaches the browser – but this is its complete interface as seen from the pages: every data request, what was sent, and the exact shape of what came back. Enough to rebuild a compatible back-end or a mock. Secret-looking values are hidden (•••).

| Method | Endpoint | Calls | Status | Type | On page |
|---|---|---|---|---|---|
${[...groups.values()].map((g) => `| ${g.method} | ${short(template(g.url)).replace(/\|/g, "\\|")} | ${g.n} | ${[...g.statuses].join(", ")} | ${(g.mime || "").replace("application/", "")} | ${[...g.pages].slice(0, 3).join(", ")} |`).join("\n")}`];
  for (const g of [...groups.values()].slice(0, 60)) {
    const body = parseJSON(g.body);
    const post = parseJSON(g.post);
    const parts = [`### ${g.method} ${short(template(g.url))}`];
    try { const q = new URL(g.url).searchParams; if ([...q.keys()].length) parts.push(`Query parameters: ${[...q.keys()].map((k) => `\`${k}\``).join(", ")}`); } catch {}
    if (post && post.query) parts.push(`GraphQL operation \`${post.operationName || "?"}\`:\n\`\`\`graphql\n${String(post.query).slice(0, 1500)}\n\`\`\``);
    else if (g.post) parts.push(`Request body:\n\`\`\`json\n${(post !== undefined ? JSON.stringify(mask(post), null, 2) : g.post).slice(0, 1200)}\n\`\`\``);
    if (body !== undefined) {
      parts.push(`Response shape:\n\`\`\`ts\n${shape(body)}\n\`\`\``);
      parts.push(`Response sample:\n\`\`\`json\n${JSON.stringify(mask(body), null, 2).slice(0, 1500)}\n\`\`\``);
    } else if (g.body) parts.push(`Response (text):\n\`\`\`\n${g.body.slice(0, 600)}\n\`\`\``);
    if (g.error) parts.push(`Failed: ${g.error}`);
    out.push(parts.join("\n\n"));
  }
  return out.join("\n\n");
}

// ---------- the whole run ----------
async function analyze(tab, opts, progress) {
  const tabId = tab.id, startUrl = tab.url;
  const origin = new URL(startUrl).origin;
  const needDebugger = opts.api || opts.screenshot;
  const session = needDebugger ? new Session(tabId) : null;
  const pages = [];
  const shots = [];
  let tech = [], knownSheets = [], queue = [];

  async function onePage(url, index, total) {
    const label = total > 1 ? `Page ${index}/${total}: ` : "";
    chrome.action.setBadgeText({ text: total > 1 ? `${index}/${total}` : "…" });
    if (session) session.page = new URL(url).pathname;
    if (index === 1 && opts.api) { progress(label + "Reloading to record the data requests…"); await loadAndSettle(tabId, null, session); }
    else if (index > 1) { progress(label + "Opening " + new URL(url).pathname); await loadAndSettle(tabId, url, session); }
    const target = { tabId };
    if (opts.scroll) { progress(label + "Scrolling through the page…"); await chrome.scripting.executeScript({ target, func: autoScroll }).catch(() => {}); if (session) await session.idle(); }
    if (index === 1) { const [r] = await chrome.scripting.executeScript({ target, func: detectTech, world: "MAIN" }).catch(() => [{ result: [] }]); tech = r.result || []; }
    await chrome.scripting.executeScript({ target, files: ["analyzer.js"] });
    const [{ result: blocked }] = await chrome.scripting.executeScript({ target, func: () => window.__bp.sheetsToFetch() });
    const todo = blocked.filter((h) => index === 1 || !knownSheets.includes(h));
    progress(label + `Downloading ${todo.length} stylesheet(s)…`);
    const fetched = await Promise.all(todo.map(async (href) => { try { const r = await fetch(href); return { href, text: r.ok ? await r.text() : "" }; } catch { return { href, text: "" }; } }));
    progress(label + "Analyzing…");
    const [{ result }] = await chrome.scripting.executeScript({
      target, func: (f, t, o) => window.__bp.run(f, t, o),
      args: [fetched, tech, { ...opts, mode: index === 1 ? "full" : "page", knownSheets }],
    });
    knownSheets = [...new Set([...knownSheets, ...result.sheets, ...blocked])];
    const [{ result: title }] = await chrome.scripting.executeScript({ target, func: () => document.title });
    const files = [];
    if (opts.screenshot && session) {
      progress(label + "Taking the full-page screenshot…");
      try {
        const parts = await session.screenshot();
        parts.forEach((png, i) => { const name = `screenshots/page-${String(index).padStart(2, "0")}${parts.length > 1 ? `-part${i + 1}` : ""}.png`; files.push(name); shots.push({ name, png }); });
      } catch (e) { files.push(`(screenshot failed: ${e.message})`); }
    }
    pages.push({ index, url, title, md: result.md, stats: result.stats, files });
    return result;
  }

  try {
    if (session) await session.start(opts.api);
    const first = await onePage(startUrl, 1, opts.scope === "site" ? "?" : 1);
    if (opts.scope === "site") {
      queue = first.links.slice(0, Math.max(0, opts.maxPages - 1));
      const total = queue.length + 1;
      for (let i = 0; i < queue.length; i++) {
        try { await onePage(queue[i], i + 2, total); }
        catch (e) { pages.push({ index: i + 2, url: queue[i], title: "(could not analyze)", md: `_Failed: ${e.message}_\n`, files: [] }); }
      }
      progress("Going back to the first page…");
      await loadAndSettle(tabId, startUrl, null);
    }
  } finally {
    if (session) await session.stop();
    chrome.action.setBadgeText({ text: "" });
  }

  // ---------- one Markdown file for everything ----------
  const short = (u) => (u.startsWith(origin) ? u.slice(origin.length) || "/" : u);
  let md;
  if (pages.length === 1) {
    md = pages[0].md;
    if (pages[0].files.length) md = md.replace("\n## 2. Page structure", `\n**Screenshot file(s):** ${pages[0].files.map((f) => `\`${f}\``).join(", ")}\n\n## 2. Page structure`);
  } else {
    const [home, ...rest] = pages;
    md = home.md.replace(/^# Blueprint: .*$/m, `# Blueprint: ${origin} (${pages.length} pages)`);
    const map = `## Site map (pages analysed)\n| # | Page | Title | Screenshot |\n|---|---|---|---|\n${pages.map((p) => `| ${p.index} | ${short(p.url)} | ${p.title} | ${p.files.map((f) => `\`${f}\``).join(" ")} |`).join("\n")}\n\nSections 1–9 describe the **whole site's design system** using page 1. Each other page has its own part at the end (structure, components, assets, behaviour, content and any CSS used only there).`;
    md = md.replace("\n## 1. Overview", `\n${map}\n\n## 1. Overview`);
    const extra = rest.map((p) => `## Page ${p.index}: ${p.title} — ${short(p.url)}\n${p.files.length ? `Screenshot: ${p.files.map((f) => `\`${f}\``).join(", ")}\n\n` : ""}${p.md}`).join("\n\n");
    // other pages go before the appendices so all descriptions come first
    const cut = md.indexOf("\n## Appendix A");
    md = cut > 0 ? md.slice(0, cut) + "\n\n" + extra + md.slice(cut) : md + "\n\n" + extra;
  }
  if (opts.api && session) {
    const api = apiSection(session.done, origin);
    const cut = md.indexOf("\n## Appendix A");
    md = cut > 0 ? md.slice(0, cut) + "\n\n" + api + "\n" + md.slice(cut) : md + "\n\n" + api + "\n";
  }

  const id = String(Date.now());
  await BlueprintDB.clear(); // keep only the latest report
  await BlueprintDB.put(id, { md, shots, title: tab.title, url: startUrl, pages: pages.length, stats: pages[0].stats, requests: session ? session.done.length : 0 });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`report.html?id=${id}`), index: tab.index + 1 });
}

let running = false;
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "status") { reply({ running }); return; }
  if (msg.type !== "analyze") return;
  if (running) { reply({ ok: false, error: "an analysis is already running" }); return; }
  running = true;
  const progress = (text) => { chrome.storage.session.set({ progress: text }); chrome.runtime.sendMessage({ type: "progress", text }).catch(() => {}); };
  analyze(msg.tab, msg.opts, progress)
    .then(() => reply({ ok: true }), (e) => reply({ ok: false, error: e.message }))
    .finally(() => { running = false; chrome.storage.session.remove("progress"); });
  return true;
});
