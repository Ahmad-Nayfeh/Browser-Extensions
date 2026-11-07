const fs = require("fs");
const path = require("path");
const { launch, site, html, sleep, download, readZip, FIX } = require("./lib");

const NAV = '<header><nav><a href="/">Home</a> <a href="/products">Products</a> <a href="/about">About</a> <a href="/logout">Log out</a> <a href="/item/1">I1</a> <a href="/item/2">I2</a></nav></header>';
const CSS = "<style>body{margin:0;font-family:Arial} header{background:#111;padding:16px} nav a{color:#fff;margin-right:16px} .card{border-radius:12px;box-shadow:0 2px 8px #0002;padding:16px;margin:16px} .btn{background:#e11d48;color:#fff;padding:10px 18px;border-radius:8px;border:0} .btn:hover{background:#be123c} @media (max-width:700px){.card{margin:4px}}</style>";
const page = (title, body) => html(title, NAV + "<main>" + body + "</main>", CSS);

module.exports = [
  {
    name: "whole site: design system, API with masked secrets, one page per template, uncut screenshots",
    timeout: 180000,
    async run(t) {
      const b = await launch(["16-site-blueprint"]);
      let logoutVisited = false;
      try {
        await site(b.ctx, {
          "shop.test/": page("Shop Home", `<h1>Welcome</h1><div id="list"></div><button class="btn">Shop now</button><p>Contact: owner@shop.test, +966 55 123 4567</p>
            <script>fetch('/api/products?limit=2').then(r=>r.json()).then(d=>{list.innerHTML=d.items.map(i=>'<div class=card><h3>'+i.name+'</h3></div>').join('')})</script>`),
          "shop.test/products": page("Products", `<h1>Products</h1><div style="height:20000px;background:linear-gradient(#fff,#ccc)">long</div>
            <script>fetch('/api/cart',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({qty:1,token:'abc123secret'})})</script>`),
          "shop.test/about": page("About", '<h1>About</h1><img src="/team.png" alt="team" loading="lazy" style="margin-top:3000px">'),
          "shop.test/item/1": page("Item", "<h1>Item</h1>"), "shop.test/item/2": page("Item", "<h1>Item</h1>"),
          "shop.test/logout": () => { logoutVisited = true; return "bye"; },
          "shop.test/team.png": { contentType: "image/png", body: fs.readFileSync(path.join(__dirname, "..", "extensions", "01-ad-blocker", "icons", "128.png")) },
          "shop.test/api/products": { contentType: "application/json", body: JSON.stringify({ items: [{ id: 1, name: "Ring Main Unit", price: 12000, created: "2026-01-02", seller: { id: 9, email: "seller@corp.test" } }], total: 1, sessionToken: "xyz-secret" }) },
          "shop.test/api/cart": { contentType: "application/json", body: '{"ok":true,"authKey":"zzz-secret"}' },
        });
        const w = b.workers["16-site-blueprint"];
        const p = await b.ctx.newPage();
        await p.goto("https://shop.test/");
        await sleep(800);
        const err = await w.evaluate(async () => {
          const [x] = (await chrome.tabs.query({})).filter((t) => (t.url || "").startsWith("https://shop.test"));
          try { await analyze(x, { scope: "site", maxPages: 10, api: true, scroll: true, screenshot: true, css: true, html: true }, () => {}); return null; } catch (e) { return e.stack; }
        });
        t.equal(err, null, "analysis finished without error");
        await sleep(1500);
        const rep = b.ctx.pages().find((x) => x.url().includes("report.html"));
        await rep.waitForTimeout(800);
        const files = readZip((await download(rep, () => rep.click("#zip"))).data);
        const md = files["blueprint.md"].toString("utf8");
        t.log(Object.keys(files));
        const map = md.slice(md.indexOf("## Site map"), md.indexOf("## 1. Overview"));
        t.ok(!logoutVisited, "'Log out' link never opened");
        t.equal(p.url(), "https://shop.test/", "tab back on the first page afterwards");
        t.ok(map.includes("/products") && map.includes("/about"), "other pages analysed");
        t.equal((map.match(/\/item\//g) || []).length, 1, "only one page per template (/item/1, /item/2)");
        for (const s of ["## 2. Page structure", "## 3. Design system", "## 4. Components", "## 5. Motion", "## 6. Responsive", "## 7. Assets", "## 10. Data & API", "## Appendix A", "## Appendix B"]) t.includes(md, s, `section "${s}"`);
        t.includes(md, "`#e11d48`", "button color in the design system");
        t.includes(md, ".btn:hover", "hover state from the site's CSS");
        t.includes(md, "max 700px", "breakpoint found");
        t.includes(md, "GET /api/products", "API endpoint listed");
        t.includes(md, "price: number", "response shape described");
        t.includes(md, '"token": "•••"', "secret in a request hidden");
        t.ok(!/xyz-secret|zzz-secret|abc123secret/.test(md), "no secret value anywhere in the file");
        t.ok(!/owner@shop\.test|seller@corp\.test/.test(md), "no e-mail address in the file");
        t.ok(!md.includes("123 4567"), "no phone number in the file");
        const parts = Object.keys(files).filter((n) => n.includes("page-") && n.includes("part"));
        t.ok(parts.length >= 3, `the 20 000 px page is in ${parts.length} parts (not cut)`);
        t.ok(Object.keys(files).filter((n) => n.endsWith(".png")).every((n) => files[n].slice(1, 4).toString() === "PNG"), "all screenshots are valid PNGs");
      } finally { await b.close(); }
    },
  },
  {
    name: "real site: analyses a well-known site without errors",
    needs: "real",
    timeout: 120000,
    async run(t) {
      const b = await launch(["16-site-blueprint"]);
      try {
        const p = await b.ctx.newPage();
        await p.goto("https://getbootstrap.com/", { waitUntil: "load", timeout: 60000 });
        const err = await b.workers["16-site-blueprint"].evaluate(async () => {
          const [x] = (await chrome.tabs.query({})).filter((t) => (t.url || "").includes("getbootstrap"));
          try { await analyze(x, { scope: "page", api: true, scroll: true, screenshot: true, css: true, html: true }, () => {}); return null; } catch (e) { return e.stack; }
        });
        t.equal(err, null, "no error");
        await sleep(1500);
        const rep = b.ctx.pages().find((x) => x.url().includes("report.html"));
        const md = await rep.inputValue("#md");
        t.includes(md, "Bootstrap", "technology detected");
        t.ok(md.length > 100000, `report has real content (${Math.round(md.length / 1024)} KB)`);
      } finally { await b.close(); }
    },
  },
];
