const { launch, site, html, sleep, download, readZip } = require("./lib");

// A shop with bugs on purpose – and with things that only LOOK like bugs (they must not be reported)
const HOME = html("Shop", `<h1>My Shop</h1>
<form id="login"><label for="em">Email</label><input id="em" type="email" name="email">
<label for="pw">Password</label><input id="pw" type="password" name="password"><button type="submit" id="go">Sign in</button></form>
<div id="msg"></div><button id="buy">Add to cart</button>
<img src="/missing.png" alt="product"><a href="/about" id="about">About us</a>
<!-- real visual problems -->
<div id="banner" style="width:2000px;height:20px;background:#eee">wide banner</div>
<p style="color:#d0d0d0">Free shipping on orders over 100 SAR</p>
<div style="width:90px;overflow:hidden;white-space:nowrap">Very long product name here</div>
<div style="position:relative"><button id="covered" style="width:120px">Checkout</button><div style="position:absolute;inset:0"></div></div>
<!-- on purpose, NOT problems -->
<div style="height:40px;overflow-y:auto;width:200px">TAGS<br><button>tag A</button><br><button>tag B</button><br><button>tag C</button><br><button>tag D</button></div>
<p style="width:150px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">A long preview that is clamped to two lines on purpose and ends with an ellipsis</p>
<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">screen reader label</span>
<script>
login.addEventListener('submit', async (e) => { e.preventDefault();
  const r = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ email: em.value }) });
  if (!r.ok) { const d = document.createElement('div'); d.className = 'alert alert-error'; d.textContent = 'Login failed: invalid email or password'; msg.appendChild(d); } });
buy.onclick = () => { console.warn('cart service slow'); const cart = undefined; cart.items.push(1); };
</script>`);
const ABOUT = html("About", `<h1>About</h1><img src="/missing2.png" alt="team"><script>fetch('/api/feed'); setTimeout(() => fetch('/api/feed'), 300);</script>`);

module.exports = [
  {
    name: "records a test session: errors, failed request, screen messages, visual problems, screenshots",
    timeout: 120000,
    async run(t) {
      const b = await launch(["15-test-recorder"]);
      try {
        await site(b.ctx, {
          "shop.test/": HOME, "shop.test/about": ABOUT,
          "shop.test/api/login": { status: 401, contentType: "application/json", body: '{"error":"Invalid credentials"}' },
          "shop.test/api/feed": { contentType: "application/json", body: "[]" },
          "shop.test/missing.png": { status: 404, body: "no" }, "shop.test/missing2.png": { status: 404, body: "no" },
        });
        const w = b.workers["15-test-recorder"];
        const p = await b.ctx.newPage();
        await p.goto("https://shop.test/");
        await w.evaluate(async () => { const [x] = (await chrome.tabs.query({})).filter((t) => (t.url || "").includes("shop.test")); await start(x); });
        await sleep(800);
        t.equal(await w.evaluate(() => chrome.action.getBadgeText({})), "REC", "icon shows REC");
        await p.fill("#em", "ahmad@example.com");
        await p.fill("#pw", "SuperSecret123");
        await sleep(1200);
        await p.click("#go");
        await sleep(2000);
        await p.click("#buy");
        await sleep(1800);
        await p.click("#about");
        await p.waitForLoadState("load");
        await sleep(2500);
        await w.evaluate(() => stop());
        await sleep(1500);
        t.equal(await w.evaluate(() => chrome.action.getBadgeText({})), "", "REC gone after stop");
        const rep = b.ctx.pages().find((x) => x.url().includes("report.html"));
        await rep.waitForTimeout(800);
        const zip = await download(rep, () => rep.click("#zip"));
        const files = readZip(zip.data);
        const md = files["report.md"].toString("utf8");
        const problems = md.slice(md.indexOf("## Problems found"), md.indexOf("## Timeline"));
        t.ok(!md.includes("SuperSecret123"), "password never written to the report");
        t.includes(md, "`•••• (hidden, 14 chars)`", "password shown as hidden");
        t.includes(problems, "Cannot read properties of undefined (reading 'items')", "JavaScript error found");
        t.includes(problems, "POST `/api/login` → **401**", "failed request found");
        t.includes(problems, '{"error":"Invalid credentials"}', "…with the server's answer");
        t.includes(problems, "Login failed: invalid email or password", "error message on screen found");
        t.includes(problems, "`/missing2.png` → 404", "missing file found");
        t.includes(problems, "Duplicate request", "duplicate request found");
        t.includes(problems, "Page is wider than the window", "visual: page too wide");
        t.includes(problems, "broken image", "visual: broken image");
        t.includes(problems, "button#covered", "visual: covered button");
        t.includes(problems, "Very long product name", "visual: cut text");
        t.includes(problems, "contrast", "visual: low contrast");
        t.ok(!problems.includes("tag A") && !problems.includes("tag B"), "no false alarm: buttons in a scroll box");
        t.ok(!problems.includes("clamped to two lines") && !problems.includes("screen reader label"), "no false alarm: clamped preview / screen-reader text");
        const shots = Object.keys(files).filter((n) => n.startsWith("screenshots/"));
        t.ok(shots.length >= 2, `screenshots in the zip (${shots.length})`);
        t.ok(shots.every((n) => files[n][0] === 0xff && files[n][1] === 0xd8), "screenshots are valid JPEGs");
        t.ok(shots.every((n) => md.includes(n)), "every screenshot is referenced in the timeline");
      } finally { await b.close(); }
    },
  },
];
