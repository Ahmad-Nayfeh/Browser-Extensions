const { launch, site, html, sleep } = require("./lib");

// A fake YouTube page with the same element names YouTube uses
const PAGE = html("YouTube", `
<ytd-reel-shelf-renderer id="shorts-shelf">Shorts shelf</ytd-reel-shelf-renderer>
<ytd-video-renderer id="normal"><a href="/watch?v=abc">normal video</a></ytd-video-renderer>
<ytd-video-renderer id="short"><a href="/shorts/abcdefgh">a short</a></ytd-video-renderer>
<ytd-watch-flexy><div id="comments">comments</div><div id="related">related</div></ytd-watch-flexy>
<div class="ytp-ce-element" id="endcard">end card</div>`);

module.exports = [
  {
    name: "hides Shorts and end cards by default; options switch other parts",
    async run(t) {
      const b = await launch(["05-youtube-cleaner"]);
      try {
        await site(b.ctx, { "www.youtube.com/*": PAGE });
        const p = await b.ctx.newPage();
        await p.goto("https://www.youtube.com/results?search_query=x");
        await sleep(500);
        const shown = (ids) => p.evaluate((list) => list.map((id) => (getComputedStyle(document.getElementById(id)).display === "none" ? "hidden" : "shown")), ids);
        t.equal((await shown(["shorts-shelf", "short", "endcard", "normal", "comments"])).join(), "hidden,hidden,hidden,shown,shown", "Shorts + end cards hidden, normal video and comments shown");
        const pop = await b.page("05-youtube-cleaner", "popup/popup.html");
        await pop.evaluate(() => chrome.storage.sync.set({ comments: true, related: true }));
        await sleep(400);
        t.equal((await shown(["comments", "related"])).join(), "hidden,hidden", "switching an option applies at once (no reload)");
      } finally { await b.close(); }
    },
  },
  {
    name: "opens Shorts links as normal videos",
    async run(t) {
      const b = await launch(["05-youtube-cleaner"]);
      try {
        await site(b.ctx, { "www.youtube.com/*": PAGE });
        const p = await b.ctx.newPage();
        await p.goto("https://www.youtube.com/shorts/jNQXAC9IVRw");
        await sleep(1000);
        t.equal(p.url(), "https://www.youtube.com/watch?v=jNQXAC9IVRw", "/shorts/ID → /watch?v=ID");
      } finally { await b.close(); }
    },
  },
];
