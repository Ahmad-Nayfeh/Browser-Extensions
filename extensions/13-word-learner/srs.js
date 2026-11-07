// Spaced repetition (Leitner boxes). Each correct answer moves a word to the
// next box, and each box waits longer before asking again. A wrong answer
// sends it back to the start. Shared by background, popup and review page.
const SRS = {
  // how long a word waits in each box before it is due again
  WAIT: [10 * 60e3, 1 * 864e5, 3 * 864e5, 7 * 864e5, 14 * 864e5, 30 * 864e5, 60 * 864e5, 120 * 864e5],
  DEFAULTS: { trigger: "dblclick", definitions: true, online: true, speak: false },

  async words() { return (await chrome.storage.local.get({ words: {} })).words; },
  async save(words) { await chrome.storage.local.set({ words }); },
  key: (w) => w.trim().toLowerCase(),

  newCard(data) {
    return { box: 0, due: Date.now(), added: Date.now(), reviews: 0, lapses: 0, ...data };
  },
  // grade: "again" | "hard" | "good" | "easy"
  grade(card, grade) {
    const max = this.WAIT.length - 1;
    if (grade === "again") { card.box = 0; card.lapses++; }
    if (grade === "good") card.box = Math.min(max, card.box + 1);
    if (grade === "easy") card.box = Math.min(max, card.box + 2);
    const wait = grade === "hard" ? Math.max(this.WAIT[0], this.WAIT[card.box] * 0.5) : this.WAIT[card.box];
    card.due = Date.now() + wait;
    card.reviews++;
    return card;
  },
  due(words) { const now = Date.now(); return Object.values(words).filter((w) => w.due <= now); },
};
