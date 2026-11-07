const { launch, site, html, prepare, sleep } = require("./lib");

// Google Translate and the dictionary are replaced by fake answers, so the test runs offline
const TRANSLATE = { contentType: "application/json", body: JSON.stringify([[["موثوق", "reliable"]], [["adjective", ["موثوق", "يعتمد عليه", "جدير بالثقة"]]], "en"]) };
const DICT = { contentType: "application/json", body: JSON.stringify([{ phonetic: "/rɪˈlaɪəbəl/", meanings: [{ partOfSpeech: "adjective", definitions: [{ definition: "Able to be trusted.", example: "a reliable car" }] }] }]) };

module.exports = [
  {
    name: "double-click shows Arabic meaning + definition; save; review with spaced repetition",
    timeout: 90000,
    async run(t) {
      const b = await launch([{ name: "13-word-learner", dir: prepare("13-word-learner", { openShadow: true }) }]);
      try {
        await site(b.ctx, {
          "read.test/": html("Read", '<p id="p" style="font-size:20px">The circuit breaker must be reliable under fault conditions.</p>'),
          "translate.googleapis.com/translate_a/single": TRANSLATE,
          "api.dictionaryapi.dev/*": DICT,
        });
        const w = b.workers["13-word-learner"];
        const p = await b.ctx.newPage();
        await p.goto("https://read.test/");
        await p.dblclick("#p", { position: { x: 235, y: 12 } });
        t.equal(await p.evaluate(() => getSelection().toString()), "reliable", "word selected");
        await sleep(6000); // Chrome's own translator is tried first; without its language pack the backup answers
        const text = await p.locator("lexi-bubble .b").innerText();
        t.includes(text, "موثوق", "Arabic meaning shown");
        t.includes(text, "يعتمد عليه", "extra meanings shown");
        t.includes(text, "Able to be trusted", "English definition shown");
        t.includes(text, "/rɪˈlaɪəbəl/", "pronunciation spelling shown");
        await p.click("lexi-bubble button.save");
        await sleep(600);
        const words = (await w.evaluate(() => chrome.storage.local.get("words"))).words;
        t.equal(words.reliable && words.reliable.ar, "موثوق", "saved with its meaning");
        t.includes(words.reliable && words.reliable.context, "must be reliable under fault", "saved with its sentence");
        t.equal(await w.evaluate(() => chrome.action.getBadgeText({})), "1", "badge: 1 word to review");
        await p.keyboard.press("Escape");
        await p.dblclick("#p", { position: { x: 20, y: 12 } }); // "The" – 3 letters, a real word
        const r = await b.page("13-word-learner", "review/review.html");
        await sleep(500);
        t.includes(await r.innerText("#cardBox"), "reliable", "review card shows the word");
        await r.keyboard.press(" ");
        t.includes(await r.innerText("#answer"), "موثوق", "Space reveals the meaning");
        await r.keyboard.press("3");
        await sleep(400);
        const after = (await w.evaluate(() => chrome.storage.local.get("words"))).words.reliable;
        t.equal(after.box, 1, "'Good' moves it to the next level");
        t.ok(Math.abs((after.due - Date.now()) / 3.6e6 - 24) < 0.1, "next review in 1 day");
        t.includes(await r.innerText("#word"), "All done", "nothing left to review");
      } finally { await b.close(); }
    },
  },
];
