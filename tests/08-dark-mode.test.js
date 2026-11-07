const { launch, site, html, sleep } = require("./lib");

const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

module.exports = [
  {
    name: "darkens light sites, keeps photos normal, skips dark sites, per-site choice",
    async run(t) {
      const b = await launch(["08-dark-mode"]);
      try {
        await site(b.ctx, {
          "light.test/": html("Light", `<p>light</p><img src="${GIF}">`, "<style>body{background:#fff}</style>"),
          "darkbody.test/": html("Dark", "<p>dark</p>", "<style>body{background:#111;color:#eee}</style>"),
          "darkhtml.test/": html("Dark html", "<p>dark</p>", "<style>html{background:#121212} body{color:#eee}</style>"),
        });
        const p = await b.ctx.newPage();
        const state = () => p.evaluate(() => ({ on: document.documentElement.hasAttribute("data-night"), filter: getComputedStyle(document.documentElement).filter, img: document.querySelector("img") ? getComputedStyle(document.querySelector("img")).filter : "" }));
        await p.goto("https://light.test/"); await sleep(300);
        let s = await state();
        t.ok(s.on && s.filter.startsWith("invert(1)"), "light site turned dark");
        t.ok(s.img.startsWith("invert(1)"), "photos inverted back (look normal)");
        await p.goto("https://darkbody.test/"); await sleep(300);
        t.ok(!(await state()).on, "site with a dark body left alone");
        await p.goto("https://darkhtml.test/"); await sleep(300);
        t.ok(!(await state()).on, "site with a dark <html> left alone");
        const pop = await b.page("08-dark-mode", "popup/popup.html");
        await pop.evaluate(() => chrome.storage.sync.set({ sites: { "darkhtml.test": "on", "light.test": "off" } }));
        await sleep(400);
        t.ok((await state()).on, "'Always dark' applies at once");
        await p.goto("https://light.test/"); await sleep(300);
        t.ok(!(await state()).on, "'Never' keeps a site light");
      } finally { await b.close(); }
    },
  },
];
