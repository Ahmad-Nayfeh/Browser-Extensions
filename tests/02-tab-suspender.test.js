const http = require("http");
const { rawWorker } = require("./lib");

// a tiny local web server, so the test needs no internet
function server() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(`<title>Page ${req.url}</title><p>${req.url}</p>`); });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

// Tab discarding crashes Chromium when a test tool is attached to the tabs,
// so this test talks to the extension's worker directly (rawWorker).
module.exports = [
  {
    name: "sleeps old tabs only, never non-web or excluded ones; saves & closes a window",
    async run(t) {
      const s = await server();
      const base = `http://127.0.0.1:${s.address().port}`;
      try {
        const r = await rawWorker("02-tab-suspender", `(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const a = await chrome.tabs.create({ url: "${base}/a", active: false });
          await chrome.tabs.create({ url: "data:text/html,not a web page", active: false });
          await wait(2500);
          const young = await sleepTabs({ olderThanMs: 60000 });
          await chrome.storage.sync.set({ neverSites: ["127.0.0.1"] });
          const never = await sleepTabs({ olderThanMs: 0 });
          await chrome.storage.sync.set({ neverSites: [] });
          const old = await sleepTabs({ olderThanMs: 1000 });
          const discarded = (await chrome.tabs.get(a.id)).discarded;
          const win = (await chrome.tabs.query({ active: true }))[0].windowId;
          await chrome.tabs.create({ url: "${base}/b", active: false });
          await wait(1500);
          const saved = await saveWindow(win);
          await wait(500);
          const left = (await chrome.tabs.query({})).map((t) => t.url);
          const sessions = (await chrome.storage.local.get("sessions")).sessions;
          return { young, never, old, discarded, saved, left, savedUrls: sessions[0].tabs.map((t) => t.url), alarm: !!(await chrome.alarms.get("check")) };
        })()`);
        t.equal(r.young, 0, "a tab seen 2 s ago stays awake");
        t.equal(r.never, 0, "an excluded site stays awake");
        t.equal(r.old, 1, "only the old web tab is put to sleep (not the data: page)");
        t.ok(r.discarded, "the tab is really discarded");
        t.ok(r.alarm, "the once-a-minute check is scheduled");
        t.equal(r.saved, 2, "both web tabs saved");
        t.ok(r.left.some((u) => u.includes("sessions.html")), "saved-tabs page opened");
        t.ok(!r.left.some((u) => u.startsWith(base)), "saved tabs closed");
        t.equal(r.savedUrls.join(), `${base}/a,${base}/b`, "saved list has both pages");
      } finally { s.close(); }
    },
  },
];
