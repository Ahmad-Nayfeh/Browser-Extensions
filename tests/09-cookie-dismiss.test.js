const { launch, site, html, sleep } = require("./lib");

const ONETRUST = html("Cookies", `<p style="height:3000px">content</p>
<script>document.body.className='ot-overflow-hidden';document.body.style.overflow='hidden';
setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" style="position:fixed;bottom:0;height:90px;width:100%;background:#ccc"><button id="onetrust-accept-btn-handler" onclick="window.choice=\\'accepted\\'">Accept</button><button id="onetrust-reject-all-handler" onclick="window.choice=\\'rejected\\';document.getElementById(\\'onetrust-consent-sdk\\').remove()">Reject all</button></div></div>'), 800);</script>`);

module.exports = [
  {
    name: "clicks 'Reject all' on a consent pop-up and unlocks scrolling",
    async run(t) {
      const b = await launch(["09-cookie-dismiss"]);
      try {
        await site(b.ctx, { "consent.test/": ONETRUST });
        await sleep(1500);
        const p = await b.ctx.newPage();
        await p.goto("https://consent.test/");
        await sleep(2500);
        const r = await p.evaluate(() => ({ choice: window.choice, banner: !!document.querySelector("#onetrust-banner-sdk"), overflow: getComputedStyle(document.body).overflow }));
        t.equal(r.choice, "rejected", "'Reject all' clicked (not 'Accept')");
        t.ok(!r.banner, "banner gone");
        t.equal(r.overflow, "auto", "page can scroll again");
      } finally { await b.close(); }
    },
  },
  {
    name: "leaves alone a banner the site already closed (you answered before)",
    async run(t) {
      const b = await launch(["09-cookie-dismiss"]);
      try {
        await site(b.ctx, { "answered.test/": html("Answered", `<p>content</p><div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" style="display:none"><button id="onetrust-reject-all-handler" onclick="window.choice='rejected'">Reject all</button></div></div>`) });
        await sleep(1500);
        const p = await b.ctx.newPage();
        await p.goto("https://answered.test/");
        await sleep(1500);
        t.equal(await p.evaluate(() => window.choice), undefined, "no click on a banner the site closed itself");
      } finally { await b.close(); }
    },
  },
  {
    name: "hides other cookie banners with the cookie list; normal content stays",
    async run(t) {
      const b = await launch(["09-cookie-dismiss"]);
      try {
        const page = html("Banner", '<div class="cookie-banner">We use cookies</div><div id="cookie-banner">banner 2</div><p id="ok">hello</p>');
        await site(b.ctx, { "generic.test/": page, "www.homify.com/": page });
        await sleep(1500);
        const p = await b.ctx.newPage();
        const shown = () => p.evaluate(() => [".cookie-banner", "#cookie-banner", "#ok"].map((s) => getComputedStyle(document.querySelector(s)).display).join());
        await p.goto("https://generic.test/");
        await sleep(600);
        t.equal(await shown(), "none,none,block", "common banner names hidden, content shown");
        // homify.com is listed as an exception for #cookie-banner in the cookie list
        await p.goto("https://www.homify.com/");
        await sleep(600);
        t.equal(await shown(), "none,block,block", "a rule a site asked to skip is not applied there");
      } finally { await b.close(); }
    },
  },
];
