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
  // (class names look alike: Bootstrap 6 also uses "lg:col-10")
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

const MAX_HEIGHT = 16000; // very tall screenshots fail in Chrome; the report says so

async function screenshot(tabId) {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    const send = (m, p) => chrome.debugger.sendCommand(target, m, p);
    const { cssContentSize: s } = await send("Page.getLayoutMetrics");
    const height = Math.min(Math.ceil(s.height), MAX_HEIGHT);
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(s.width), height, scale: 1 } });
    return { png: "data:image/png;base64," + data, cut: s.height > MAX_HEIGHT };
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function analyze(tab, opts, progress) {
  const target = { tabId: tab.id };
  progress("Reading technologies…");
  const [{ result: tech }] = await chrome.scripting.executeScript({ target, func: detectTech, world: "MAIN" }).catch(() => [{ result: [] }]);
  await chrome.scripting.executeScript({ target, files: ["analyzer.js"] });
  const [{ result: blocked }] = await chrome.scripting.executeScript({ target, func: () => window.__bp.sheetsToFetch() });

  // the page can't read stylesheets from other domains; the extension can download them
  progress(`Downloading ${blocked.length} stylesheet(s)…`);
  const fetched = await Promise.all(blocked.map(async (href) => {
    try { const r = await fetch(href); return { href, text: r.ok ? await r.text() : "" }; } catch { return { href, text: "" }; }
  }));

  progress("Analyzing the page…");
  const [{ result }] = await chrome.scripting.executeScript({ target, func: (f, t, o) => window.__bp.run(f, t, o), args: [fetched, tech, opts] });

  let shot = null;
  if (opts.screenshot) {
    progress("Taking a full-page screenshot…");
    try { shot = await screenshot(tab.id); } catch (e) { shot = { error: e.message }; }
  }
  const id = String(Date.now());
  await BlueprintDB.clear(); // keep only the latest report
  await BlueprintDB.put(id, { md: result.md, stats: result.stats, shot, title: tab.title, url: tab.url });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`report.html?id=${id}`), index: tab.index + 1 });
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type !== "analyze") return;
  const progress = (text) => chrome.runtime.sendMessage({ type: "progress", text }).catch(() => {});
  analyze(msg.tab, msg.opts, progress).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: e.message }));
  return true;
});
