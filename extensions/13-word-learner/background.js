importScripts("srs.js");

// ---------- online lookups (only when Chrome's own translator isn't available) ----------
async function googleTranslate(word) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&dt=bd&q=" + encodeURIComponent(word);
  const d = await (await fetch(url)).json();
  const main = (d[0] || []).map((x) => x[0]).join("").trim();
  // d[1] = dictionary: [[partOfSpeech, [meanings...]], ...]
  const more = (d[1] || []).map(([pos, list]) => ({ pos, list: (list || []).slice(0, 5) }));
  return { ar: main, more };
}

async function define(word) {
  const r = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word));
  if (!r.ok) return null;
  const [e] = await r.json();
  const phonetic = e.phonetic || (e.phonetics || []).map((p) => p.text).find(Boolean) || "";
  const meanings = (e.meanings || []).slice(0, 2).map((m) => ({
    pos: m.partOfSpeech,
    def: m.definitions[0] && m.definitions[0].definition,
    example: m.definitions[0] && m.definitions[0].example,
  }));
  return { phonetic, meanings };
}

// ---------- badge = number of words due for review ----------
async function updateBadge() {
  const n = SRS.due(await SRS.words()).length;
  chrome.action.setBadgeBackgroundColor({ color: "#9333ea" });
  chrome.action.setBadgeText({ text: n ? String(n) : "" });
}
chrome.alarms.onAlarm.addListener((a) => a.name === "badge" && updateBadge());
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create("badge", { periodInMinutes: 30 }); updateBadge(); });
chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((c) => c.words && updateBadge());

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  (async () => {
    try {
      if (msg.type === "translate") reply(await googleTranslate(msg.word));
      else if (msg.type === "define") reply(await define(msg.word));
      else if (msg.type === "save") {
        const words = await SRS.words();
        const k = SRS.key(msg.card.word);
        words[k] = words[k] ? { ...words[k], ...msg.card } : SRS.newCard(msg.card);
        await SRS.save(words);
        reply(true);
      } else if (msg.type === "unsave") {
        const words = await SRS.words();
        delete words[SRS.key(msg.word)];
        await SRS.save(words);
        reply(true);
      } else if (msg.type === "isSaved") reply(!!(await SRS.words())[SRS.key(msg.word)]);
    } catch (e) { reply({ error: e.message }); }
  })();
  return true;
});
