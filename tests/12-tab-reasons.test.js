const { launch, site, html, prepare, sleep } = require("./lib");

module.exports = [
  {
    name: "asks why a new tab is open, reminds you later, closes it when done",
    async run(t) {
      const b = await launch([{ name: "12-tab-reasons", dir: prepare("12-tab-reasons", { openShadow: true }) }]);
      try {
        await site(b.ctx, { "home.test/": html("Home", "<p>home</p>"), "shop.test/": html("Shop", "<p>shop</p>") });
        const w = b.workers["12-tab-reasons"];
        await w.evaluate(() => chrome.storage.sync.set({ ask: "always", remindMin: 0.05 })); // remind after 3 s for the test
        const home = await b.ctx.newPage();
        await home.goto("https://home.test/");
        const [p] = await Promise.all([b.ctx.waitForEvent("page"), w.evaluate(() => chrome.tabs.create({ url: "https://shop.test/", active: true }))]);
        await p.waitForLoadState("load");
        await sleep(1200);
        t.ok(await p.locator("why-bar .b").isVisible(), "question bar shown on the new tab");
        await p.locator("why-bar input").fill("compare RMU prices");
        await p.locator("why-bar input").press("Enter");
        await sleep(400);
        const reasons = async () => Object.values((await w.evaluate(() => chrome.storage.local.get("reasons"))).reasons).map((r) => r.text);
        t.equal((await reasons()).join(), "compare RMU prices", "reason saved");
        t.equal(await p.locator("why-bar").count(), 0, "bar closes after Enter");
        await w.evaluate(async () => { const [x] = await chrome.tabs.query({ url: "https://home.test/*" }); await chrome.tabs.update(x.id, { active: true }); });
        await sleep(4000);
        await w.evaluate(async () => { const [x] = await chrome.tabs.query({ url: "https://shop.test/*" }); await chrome.tabs.update(x.id, { active: true }); });
        await sleep(1200);
        t.includes(await p.locator("why-bar .b").innerText(), "compare RMU prices", "reminder shows the reason when you come back");
        await p.locator("why-bar .done").click();
        await sleep(800);
        t.ok(p.isClosed(), "'Done – close tab' closes it");
        t.equal((await reasons()).length, 0, "reason removed with the tab");
      } finally { await b.close(); }
    },
  },
  {
    name: "doesn't ask when few tabs are open (default setting)",
    async run(t) {
      const b = await launch([{ name: "12-tab-reasons", dir: prepare("12-tab-reasons", { openShadow: true }) }]);
      try {
        await site(b.ctx, { "shop.test/": html("Shop", "<p>shop</p>") });
        const w = b.workers["12-tab-reasons"];
        const [p] = await Promise.all([b.ctx.waitForEvent("page"), w.evaluate(() => chrome.tabs.create({ url: "https://shop.test/", active: true }))]);
        await p.waitForLoadState("load");
        await sleep(1200);
        t.equal(await p.locator("why-bar").count(), 0, "no question with only 2 tabs open");
      } finally { await b.close(); }
    },
  },
];
