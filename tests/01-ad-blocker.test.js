const fs = require("fs");
const path = require("path");
const { launch, site, html, prepare, sleep, FIX } = require("./lib");

const fetchAll = (page, urls) => page.evaluate(async (list) => {
  const out = {};
  for (const u of list) { try { await fetch(u, { mode: "no-cors" }); out[u] = "allowed"; } catch { out[u] = "blocked"; } }
  return out;
}, urls);

module.exports = [
  {
    name: "blocks ad & tracker requests, lets normal ones through",
    async run(t) {
      const b = await launch(["01-ad-blocker"]);
      try {
        await site(b.ctx, { "news.test/": html("News", "<p>hello</p>") });
        await sleep(1500);
        const info = await b.workers["01-ad-blocker"].evaluate(async () => ({ sets: await chrome.declarativeNetRequest.getEnabledRulesets() }));
        t.equal(info.sets.join(","), "easylist,easyprivacy,peterlowe,youtube", "all rule lists enabled");
        const p = await b.ctx.newPage();
        await p.goto("https://news.test/");
        const r = await fetchAll(p, ["https://securepubads.g.doubleclick.net/tag/js/gpt.js", "https://www.google-analytics.com/analytics.js", "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", "https://news.test/api/data"]);
        t.equal(r["https://securepubads.g.doubleclick.net/tag/js/gpt.js"], "blocked", "ad script blocked");
        t.equal(r["https://www.google-analytics.com/analytics.js"], "blocked", "tracker blocked");
        t.equal(r["https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"], "blocked", "AdSense blocked");
        t.equal(r["https://news.test/api/data"], "allowed", "normal request allowed");
      } finally { await b.close(); }
    },
  },
  {
    name: "hides ad boxes, keeps normal content; allow-list switches it off",
    async run(t) {
      const b = await launch(["01-ad-blocker"]);
      try {
        await site(b.ctx, { "news.test/": html("News", '<div id="AD_300">ad</div><div class="adsbygoogle-box">ad</div><p id="ok">article</p>') });
        await sleep(1500);
        const p = await b.ctx.newPage();
        const shown = () => p.evaluate(() => ["#AD_300", ".adsbygoogle-box", "#ok"].map((s) => getComputedStyle(document.querySelector(s)).display));
        await p.goto("https://news.test/");
        t.equal((await shown()).join(), "none,none,block", "ad boxes hidden, article visible");
        const opt = await b.page("01-ad-blocker", "options/options.html");
        await opt.evaluate(() => chrome.runtime.sendMessage({ type: "toggleSite", host: "news.test" }));
        await p.goto("https://news.test/");
        t.equal((await shown()).join(), "block,block,block", "nothing hidden on an allowed site");
        const tracker = await fetchAll(p, ["https://www.google-analytics.com/analytics.js"]);
        t.equal(Object.values(tracker)[0], "allowed", "trackers allowed on an allowed site");
      } finally { await b.close(); }
    },
  },
  {
    name: "general hiding rules with site exceptions: applied everywhere except those sites",
    async run(t) {
      const b = await launch(["01-ad-blocker"]);
      try {
        // EasyList hides #ad-carousel everywhere, but has an exception for dez.ro
        const page = html("Page", '<div id="ad-carousel">ads</div><p id="ok">text</p>');
        await site(b.ctx, { "news.test/": page, "dez.ro/": page });
        await sleep(1500);
        const p = await b.ctx.newPage();
        const state = () => p.evaluate(() => ["#ad-carousel", "#ok"].map((s) => getComputedStyle(document.querySelector(s)).display).join());
        await p.goto("https://news.test/");
        await sleep(500);
        t.equal(await state(), "none,block", "hidden on a normal site");
        await p.goto("https://dez.ro/");
        await sleep(500);
        t.equal(await state(), "block,block", "not hidden on the excepted site");
      } finally { await b.close(); }
    },
  },
  {
    name: "popup counts blocked requests on the page",
    async run(t) {
      const b = await launch([{ name: "01-ad-blocker", dir: prepare("01-ad-blocker", { permissions: ["declarativeNetRequestFeedback", "tabs"] }) }]);
      try {
        await site(b.ctx, { "news.test/": html("News", '<script src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script><script src="https://www.google-analytics.com/analytics.js"></script><img src="https://pagead2.googlesyndication.com/pagead/x.gif">') });
        await sleep(1500);
        const p = await b.ctx.newPage();
        await p.goto("https://news.test/");
        await sleep(1500); // Chrome records matches a moment after the page loads
        const pop = await b.popup("01-ad-blocker", "popup/popup.html", await b.tabOf(b.workers["01-ad-blocker"], "news.test"));
        await sleep(500);
        t.equal(await pop.innerText("#count"), "3", "3 requests counted");
        t.equal(await pop.innerText("#host"), "news.test", "site name shown");
      } finally { await b.close(); }
    },
  },
  {
    name: "element picker hides what you click, and remembers it",
    async run(t) {
      const b = await launch([{ name: "01-ad-blocker", dir: prepare("01-ad-blocker", { openShadow: true, permissions: ["tabs"] }) }]);
      try {
        await site(b.ctx, { "pick.test/": html("Pick", '<div class="annoying" style="height:100px;background:orange">ANNOYING</div><p>keep</p>') });
        await sleep(1500);
        const p = await b.ctx.newPage();
        await p.goto("https://pick.test/");
        await b.workers["01-ad-blocker"].evaluate(async () => { const [x] = (await chrome.tabs.query({})).filter((t) => (t.url || "").includes("pick.test")); await chrome.scripting.executeScript({ target: { tabId: x.id }, files: ["picker/picker.js"] }); });
        await p.mouse.click(50, 40);
        t.equal(await p.inputValue("shield-picker >> textarea"), "div.annoying", "picker proposes a selector");
        await p.click("shield-picker >> button[data-a=hide]");
        await sleep(300);
        t.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".annoying")).display), "none", "hidden right away");
        await p.reload();
        await sleep(500);
        t.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".annoying")).display), "none", "still hidden after reload");
        t.equal(await p.evaluate(() => getComputedStyle(document.querySelector("p")).display), "block", "other content untouched");
      } finally { await b.close(); }
    },
  },
  {
    name: "YouTube: removes ad data, skips a leftover ad, restores speed",
    async run(t) {
      const b = await launch(["01-ad-blocker"]);
      try {
        const page = html("Watch", `<div class="html5-video-player" id="player"><video id="v" muted></video></div>
<script>
  window.ytInitialPlayerResponse = { videoDetails: {}, adPlacements: [1], playerAds: [1] };
  window.left1 = Object.keys(window.ytInitialPlayerResponse).join();
  fetch('/youtubei/v1/player').then(r => r.json()).then(d => window.left2 = Object.keys(d).join());
  window.left3 = Object.keys(JSON.parse('{"a":1,"playerResponse":{"adSlots":[1],"b":2}}').playerResponse).join();
  v.src = '/v.webm'; v.playbackRate = 1.5; v.play();
  setTimeout(() => player.classList.add('ad-showing'), 1200);
  setTimeout(() => player.classList.remove('ad-showing'), 2000);
</script>`);
        await site(b.ctx, {
          "www.youtube.com/watch": page,
          "www.youtube.com/youtubei/v1/player": { contentType: "application/json", body: '{"videoDetails":{},"adSlots":[1],"playerAds":[1]}' },
          "www.youtube.com/v.webm": { contentType: "video/webm", body: fs.readFileSync(path.join(FIX, "video.webm")) },
        });
        await sleep(1500);
        const p = await b.ctx.newPage();
        const logs = [];
        p.on("console", (m) => { if (m.text().startsWith("[Shield]")) logs.push(m.text()); });
        await p.goto("https://www.youtube.com/watch?v=x");
        await sleep(3000);
        t.equal(await p.evaluate(() => window.left1), "videoDetails", "ad data removed from the page's first data");
        t.equal(await p.evaluate(() => window.left2), "videoDetails", "ad data removed from later requests");
        t.equal(await p.evaluate(() => window.left3), "b", "ad data removed from JSON.parse");
        t.equal(await p.evaluate(() => document.getElementById("v").playbackRate), 1.5, "your playback speed restored after the ad");
        t.ok(logs.some((l) => l.includes("ad started anyway")) && logs.some((l) => l.includes("ad gone")), "fallback skip logged");
      } finally { await b.close(); }
    },
  },
  {
    name: "real site: far fewer requests on an ad-heavy page",
    needs: "real",
    async run(t) {
      const count = async (exts) => {
        const b = await launch(exts);
        try {
          await sleep(1500);
          const p = await b.ctx.newPage();
          let n = 0;
          p.on("request", () => n++);
          await p.goto("https://www.theverge.com/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
          await sleep(8000);
          return n;
        } finally { await b.close(); }
      };
      const without = await count([]);
      const withShield = await count(["01-ad-blocker"]);
      t.log({ without, withShield });
      t.ok(without > 100, `page loaded without Shield (${without} requests)`);
      t.ok(withShield < without * 0.6, `at least 40% fewer requests with Shield (${without} → ${withShield})`);
    },
  },
];
