const { launch, site, html, sleep } = require("./lib");

module.exports = [
  {
    name: "saves pages and notes, shows the badge, lists, marks read, searches",
    async run(t) {
      const b = await launch(["10-read-later"]);
      try {
        await site(b.ctx, { "one.test/": html("One", "<p>1</p>"), "two.test/": html("Two", "<p>2</p>") });
        const w = b.workers["10-read-later"];
        const p = await b.ctx.newPage();
        await p.goto("https://one.test/#part");
        const tab = await b.tabOf(w, "one.test");
        // save through the popup like a user
        const pop = await b.popup("10-read-later", "app.html", tab);
        await sleep(300);
        await pop.click("#save");
        // in real use the popup is not a tab; here it is, so make the page the active tab again
        await p.bringToFront();
        await sleep(500);
        t.equal(await w.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tab.id), "•", "badge shows • for a saved page");
        await pop.fill("#note", "check this later");
        await sleep(800);
        await p.bringToFront();
        await sleep(500);
        t.equal(await w.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tab.id), "✎", "badge shows ✎ for a page with a note");
        await w.evaluate(() => Store.put({ url: "https://two.test/", title: "Two page", saved: true }));
        const app = await b.page("10-read-later", "app.html?full");
        await sleep(400);
        const list = () => app.innerText("#list");
        t.includes(await list(), "Two page", "list shows saved pages");
        t.includes(await list(), "check this later", "notes shown under the page");
        await app.click('.item:has-text("Two page") button[title="Mark as read"]');
        await sleep(300);
        t.ok(!(await list()).includes("Two page"), "marked as read → leaves 'To read'");
        await app.click("[data-tab=read]");
        t.includes(await list(), "Two page", "…and appears in 'Read'");
        await app.click("[data-tab=notes]");
        t.includes(await list(), "check this later", "'Notes' tab lists notes");
        await app.fill("#q", "zzz");
        await sleep(100);
        t.includes(await list(), "Nothing matches", "search filters");
        const keys = await w.evaluate(async () => Object.keys(await Store.all()).sort().join());
        t.equal(keys, "https://one.test/,https://two.test/", "the #part of a link is dropped (no duplicates)");
      } finally { await b.close(); }
    },
  },
];
