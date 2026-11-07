const { launch, site, html, sleep } = require("./lib");

module.exports = [
  {
    name: "applies each site's CSS, the global CSS, and live edits from the popup",
    async run(t) {
      const b = await launch(["07-site-css"]);
      try {
        await site(b.ctx, { "a.test/": html("A", "<h1>Title</h1><p>text</p>"), "b.test/": html("B", "<h1>Title</h1><p>text</p>") });
        const w = b.workers["07-site-css"];
        await w.evaluate(() => chrome.storage.local.set({ styles: { "a.test": { css: "h1 { color: rgb(255, 0, 0) } p { display: none }", on: true } }, global: { css: "body { outline: 3px solid rgb(0, 128, 0) }", on: true } }));
        const p = await b.ctx.newPage();
        const read = () => p.evaluate(() => ({ h1: getComputedStyle(document.querySelector("h1")).color, p: getComputedStyle(document.querySelector("p")).display, outline: getComputedStyle(document.body).outlineColor }));
        await p.goto("https://a.test/");
        let r = await read();
        t.equal(r.h1, "rgb(255, 0, 0)", "site CSS applied");
        t.equal(r.p, "none", "site CSS can hide things");
        t.equal(r.outline, "rgb(0, 128, 0)", "global CSS applied");
        await p.goto("https://b.test/");
        r = await read();
        t.equal(r.h1, "rgb(0, 0, 0)", "other site not affected by a.test's CSS");
        t.equal(r.outline, "rgb(0, 128, 0)", "global CSS on every site");
        // live editing from the popup
        await p.goto("https://a.test/");
        const pop = await b.popup("07-site-css", "popup/popup.html", await b.tabOf(w, "a.test"));
        await pop.fill("#css", "h1 { color: rgb(0, 0, 255) }");
        await sleep(800);
        t.equal((await read()).h1, "rgb(0, 0, 255)", "change shows at once (old rule removed)");
        await pop.click("#on + span");
        await sleep(600);
        t.equal((await read()).h1, "rgb(0, 0, 0)", "switch turns the site's CSS off");
        const opt = await b.page("07-site-css", "options/options.html");
        await sleep(300);
        t.includes(await opt.innerText("#sites"), "a.test", "all-sites page lists the site");
      } finally { await b.close(); }
    },
  },
];
