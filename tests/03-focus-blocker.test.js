const { launch, site, html, sleep } = require("./lib");

module.exports = [
  {
    name: "blocks a site, enforces a daily limit, tracks time",
    async run(t) {
      const b = await launch(["03-focus-blocker"]);
      try {
        await site(b.ctx, { "fun.test/": html("Fun", "<p>fun</p>"), "news.test/": html("News", "<p>news</p>"), "work.test/": html("Work", "<p>work</p>") });
        const w = b.workers["03-focus-blocker"];
        await w.evaluate(() => chrome.storage.sync.set({ sites: [{ domain: "fun.test", mode: "block", minutes: 15 }, { domain: "news.test", mode: "limit", minutes: 1 }] }));
        await sleep(800);
        const p = await b.ctx.newPage();
        await p.goto("https://fun.test/").catch(() => {});
        await sleep(500);
        t.includes(p.url(), "blocked/blocked.html?d=fun.test", "blocked site redirects to the block page");
        t.includes(await p.innerText("body"), "is blocked", "block page explains it");
        await p.goto("https://work.test/");
        t.equal(p.url(), "https://work.test/", "other sites open normally");
        await p.goto("https://news.test/");
        await p.bringToFront();
        await sleep(2500);
        const s = await w.evaluate(async () => ({ current: (await chrome.storage.session.get("current")).current, alarm: !!(await chrome.alarms.get("limit")) }));
        t.equal(s.current && s.current.domain, "news.test", "time is being counted for the limited site");
        t.ok(s.alarm, "an alarm is set for the moment the limit runs out");
        await w.evaluate(async () => { await chrome.storage.local.set({ usage: { date: new Date().toLocaleDateString("en-CA"), used: { "news.test": 61000 } } }); await chrome.storage.session.set({ current: null }); await enforce(); });
        await sleep(1500);
        t.includes(p.url(), "blocked/blocked.html?d=news.test&m=limit", "open tab is blocked when the limit is used up");
        const pop = await b.page("03-focus-blocker", "popup/popup.html");
        await sleep(400);
        t.includes(await pop.innerText("#list"), "news.test — 1 min / 1 min", "popup shows the time used");
      } finally { await b.close(); }
    },
  },
];
