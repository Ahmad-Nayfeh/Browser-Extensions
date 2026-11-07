const { launch, site, html, prepare, sleep, download } = require("./lib");

const LONG = html("Long page", '<div style="position:sticky;top:0;background:#333;color:#fff;height:40px">STICKY</div>' +
  Array.from({ length: 60 }, (_, i) => `<p style="height:50px;margin:0;background:hsl(${i * 6},70%,80%)">row ${i}</p>`).join(""), "<style>body{margin:0}</style>");

module.exports = [
  {
    name: "captures visible area and the full page (sticky header once), edits, exports PNG/JPG/PDF",
    async run(t) {
      // tabs + all-sites permissions stand in for "you clicked the icon" (activeTab)
      const b = await launch([{ name: "06-page-screenshot", dir: prepare("06-page-screenshot", { permissions: ["tabs"], hosts: ["<all_urls>"] }) }], { viewport: { width: 800, height: 600 } });
      try {
        await site(b.ctx, { "long.test/": LONG });
        const p = await b.ctx.newPage();
        await p.goto("https://long.test/");
        const w = b.workers["06-page-screenshot"];
        const editor = async (mode) => {
          const r = await w.evaluate(async (m) => { const [x] = (await chrome.tabs.query({})).filter((t) => (t.url || "").includes("long.test")); return capture(m, x); }, mode);
          t.ok(r.ok, `${mode} capture works (${r.error || ""})`);
          await sleep(1500);
          const ed = b.ctx.pages().filter((x) => x.url().includes("editor.html")).pop();
          await ed.waitForTimeout(600);
          return ed;
        };
        const v = await editor("visible");
        t.equal(await v.evaluate(() => `${cv.width}x${cv.height}`), "800x600", "visible area = window size");
        const ed = await editor("full");
        t.equal(await ed.evaluate(() => `${cv.width}x${cv.height}`), "800x3040", "full page = whole page height");
        // brightness of one pixel (exact colors differ a little between machines' color settings)
        const light = (y) => ed.evaluate((yy) => { const [r, g, b] = ctx.getImageData(5, yy, 1, 1).data; return Math.round(0.299 * r + 0.587 * g + 0.114 * b); }, y);
        t.ok((await light(10)) < 100, "dark sticky header at the top");
        t.ok((await light(620)) > 150, "sticky header not repeated further down (light row there)");
        const box = await ed.locator("#cv").boundingBox();
        const drag = async (x1, y1, x2, y2) => { await ed.mouse.move(box.x + x1, box.y + y1); await ed.mouse.down(); await ed.mouse.move(box.x + x2, box.y + y2, { steps: 5 }); await ed.mouse.up(); };
        await drag(20, 20, 120, 80);
        await ed.keyboard.press("b");
        await drag(200, 20, 300, 80);
        t.equal(await ed.evaluate(() => items.map((i) => i.type).join()), "rect,blur", "box and blur drawn");
        // the picture is shown a bit smaller than its real size: 400 screen px = 400 × scale picture px
        const scale = await ed.evaluate(() => cv.width / cv.getBoundingClientRect().width);
        await ed.keyboard.press("c");
        await drag(10, 10, 410, 310);
        const [cw, ch] = await ed.evaluate(() => [cv.width, cv.height]);
        t.ok(Math.abs(cw - 400 * scale) <= 2 && Math.abs(ch - 300 * scale) <= 2, `crop keeps the dragged area (${cw}×${ch}, scale ${scale.toFixed(3)})`);
        await ed.keyboard.press("Control+z");
        t.equal(await ed.evaluate(() => `${cv.width}x${cv.height}`), "800x3040", "undo works");
        const png = await download(ed, () => ed.click("#png"));
        t.ok(png.data.slice(1, 4).toString() === "PNG", "PNG file valid");
        const jpg = await download(ed, () => ed.click("#jpg"));
        t.ok(jpg.data[0] === 0xff && jpg.data[1] === 0xd8, "JPG file valid");
        const pdf = await download(ed, () => ed.click("#pdf"));
        const text = pdf.data.toString("latin1");
        t.ok(text.startsWith("%PDF-1.4") && text.trimEnd().endsWith("%%EOF"), "PDF file valid");
        t.equal((text.match(/\/Type \/Page /g) || []).length, 3, "long page split into 3 A4 pages");
      } finally { await b.close(); }
    },
  },
];
