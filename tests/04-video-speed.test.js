const fs = require("fs");
const path = require("path");
const { launch, site, html, sleep, FIX } = require("./lib");

const PAGE = html("Video", '<input id="inp"><video id="v" width="320" height="180" muted></video><script>v.src="/video.webm";v.play();</script>');

module.exports = [
  {
    name: "keyboard shortcuts change speed; typing in a field is ignored; speed is remembered",
    async run(t) {
      const b = await launch(["04-video-speed"]);
      try {
        await site(b.ctx, { "video.test/*": (u) => (u.pathname.endsWith(".webm") ? { contentType: "video/webm", body: fs.readFileSync(path.join(FIX, "video.webm")) } : PAGE) });
        const p = await b.ctx.newPage();
        await p.goto("https://video.test/");
        await sleep(800);
        const rate = () => p.evaluate(() => document.getElementById("v").playbackRate);
        await p.mouse.click(700, 500);
        for (const k of ["d", "d", "d"]) await p.keyboard.press(k);
        t.equal(await rate(), 1.3, "D ×3 → 1.3×");
        await p.keyboard.press("s");
        t.equal(await rate(), 1.2, "S → 1.2×");
        await p.keyboard.press("g");
        t.equal(await rate(), 1.75, "G → favorite 1.75×");
        await p.keyboard.press("r");
        t.equal(await rate(), 1, "R → 1×");
        await p.click("#inp");
        await p.keyboard.press("d");
        t.equal(await rate(), 1, "typing in a text field doesn't change speed");
        t.equal(await p.inputValue("#inp"), "d", "the letter goes into the field");
        t.ok(await p.evaluate(() => !!document.querySelector("speedy-indicator")), "on-screen indicator shown");
        await p.mouse.click(700, 500);
        await p.keyboard.press("g");
        await sleep(1200);
        const p2 = await b.ctx.newPage();
        await p2.goto("https://video.test/other");
        await sleep(1000);
        t.equal(await p2.evaluate(() => document.getElementById("v").playbackRate), 1.75, "new video starts at the remembered speed");
      } finally { await b.close(); }
    },
  },
];
