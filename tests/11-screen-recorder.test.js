const { launch, site, html, sleep, download } = require("./lib");

// Chromium's test switches: fake camera/microphone, and "Entire screen" chosen automatically
const MEDIA = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-select-desktop-capture-source=Entire screen"];
const view = (p) => p.evaluate(() => ["setup", "areaView", "recView", "editView"].find((id) => !document.getElementById(id).hidden));

module.exports = [
  {
    name: "records the screen with camera bubble, pauses, stops, saves and trims",
    needs: "display",
    timeout: 150000,
    async run(t) {
      const b = await launch(["11-screen-recorder"], { headful: true, args: MEDIA });
      try {
        const rec = await b.page("11-screen-recorder", "recorder.html");
        await rec.check("#cam");
        await rec.uncheck("#countdown");
        await rec.uncheck("#area");
        await rec.click("#start");
        await sleep(2500);
        t.equal(await view(rec), "recView", "recording started");
        t.ok(await rec.evaluate(() => !!(window.documentPictureInPicture && documentPictureInPicture.window)), "floating controls window open");
        await sleep(2000);
        await rec.click("#pauseBtn");
        await sleep(1200);
        const a = await rec.innerText("#recTime");
        await sleep(1200);
        t.equal(await rec.innerText("#recTime"), a, "timer stops while paused");
        t.equal(await rec.evaluate(() => recorder.state), "paused", "recorder paused");
        await rec.click("#pauseBtn");
        await sleep(1500);
        await rec.click("#stopBtn");
        await sleep(3000);
        t.equal(await view(rec), "editView", "result page shown after stop");
        const d = await rec.evaluate(() => { const v = document.getElementById("result"); return { w: v.videoWidth, h: v.videoHeight, dur: v.duration }; });
        t.ok(d.w > 0 && d.dur > 2 && d.dur < 10, `video has a picture and a length (${d.w}×${d.h}, ${d.dur.toFixed(1)} s)`);
        const full = await download(rec, () => rec.click("#saveBtn"));
        t.ok(full.data.length > 10000, `full video saved (${full.name})`);
        if (full.name.endsWith(".webm")) t.ok(full.data.indexOf(Buffer.from([0x44, 0x89, 0x88])) > 0, "WebM file has its length written in (seekable)");
        await rec.evaluate(() => { trimStart.value = 1; trimEnd.value = 2; trimStart.dispatchEvent(new Event("input")); });
        t.includes(await rec.innerText("#saveBtn"), "trimmed", "save button switches to trimmed");
        const cut = await download(rec, () => rec.click("#saveBtn"));
        t.ok(cut.data.length > 1000 && cut.data.length < full.data.length, "trimmed video is smaller");
      } finally { await b.close(); }
    },
  },
  {
    name: "records only a chosen area; drawing layer works on a web page",
    needs: "display",
    timeout: 150000,
    async run(t) {
      const b = await launch(["11-screen-recorder"], { headful: true, args: MEDIA });
      try {
        await site(b.ctx, { "draw.test/": html("Draw", "<h1>Draw on me</h1>") });
        const page = await b.ctx.newPage();
        await page.goto("https://draw.test/");
        const rec = await b.page("11-screen-recorder", "recorder.html");
        await rec.check("#area");
        await rec.uncheck("#countdown");
        await rec.uncheck("#cam");
        await rec.click("#start");
        await sleep(2000);
        t.equal(await view(rec), "areaView", "area chooser shown");
        const box = await rec.locator("#preview").boundingBox();
        await rec.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
        await rec.mouse.down();
        await rec.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 6 });
        await rec.mouse.up();
        const full = await rec.evaluate(() => ({ w: preview.videoWidth, h: preview.videoHeight })); // size of the captured picture
        await rec.click("#areaGo");
        await sleep(1500);
        await page.bringToFront();
        await sleep(500);
        await rec.evaluate(() => documentPictureInPicture.window.document.getElementById("d").click());
        await sleep(800);
        t.ok(await page.evaluate(() => !!document.querySelector("reel-draw")), "drawing layer added to the page");
        await page.keyboard.press("Escape");
        await sleep(200);
        t.ok(await page.evaluate(() => !document.querySelector("reel-draw")), "Esc closes it");
        await sleep(800);
        await rec.evaluate(() => documentPictureInPicture.window.document.getElementById("s").click());
        await sleep(3000);
        const area = await rec.evaluate(() => { const v = document.getElementById("result"); return { w: v.videoWidth, h: v.videoHeight }; });
        t.ok(Math.abs(area.w - full.w / 2) <= 4 && Math.abs(area.h - full.h / 2) <= 4, `the video is the chosen half of the picture (${area.w}×${area.h} of ${full.w}×${full.h})`);
      } finally { await b.close(); }
    },
  },
];
