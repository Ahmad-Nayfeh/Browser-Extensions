// Lexi – on every page this is just ONE double-click listener.
// The bubble is built the first time you actually use it.
(() => {
  if (window.__lexi) return;
  window.__lexi = true;

  const DEFAULTS = { trigger: "dblclick", definitions: true, online: true, speak: false };
  let opts = DEFAULTS;
  chrome.storage.sync.get(DEFAULTS).then((o) => (opts = o));
  chrome.storage.onChanged.addListener((c, a) => { if (a === "sync") for (const k in c) opts[k] = c[k].newValue; });

  const WORD = /^[A-Za-z][A-Za-z'’-]{1,40}$/;
  let host = null, root = null, translator = null;

  document.addEventListener("dblclick", (e) => {
    if (opts.trigger === "alt" && !e.altKey) return;
    if (e.target.closest && e.target.closest("input, textarea, [contenteditable=''], [contenteditable=true]")) return;
    const sel = getSelection();
    const word = sel && sel.toString().trim().replace(/[’]/g, "'");
    if (!word || !WORD.test(word)) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    open(word, rect, sentenceOf(sel));
  });

  // the sentence around the word – saved with it, so you remember where you met it
  function sentenceOf(sel) {
    const node = sel.anchorNode;
    const text = (node && node.parentElement ? node.parentElement.innerText || node.textContent : "") || "";
    const word = sel.toString().trim();
    const i = text.indexOf(word);
    if (i < 0) return "";
    const start = Math.max(text.lastIndexOf(".", i) + 1, text.lastIndexOf("\n", i) + 1, i - 160);
    let end = text.slice(i).search(/[.!?\n]/);
    end = end < 0 ? Math.min(text.length, i + 160) : i + end + 1;
    return text.slice(start, Math.min(end, i + 200)).trim();
  }

  function build() {
    host = document.createElement("lexi-bubble");
    host.style.cssText = "all:initial;position:absolute;z-index:2147483647;top:0;left:0";
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      .b { position: absolute; width: 300px; background: #fff; color: #111827; border: 1px solid #e5e7eb; border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,.18); font: 13px/1.45 system-ui, sans-serif; padding: 12px 14px; }
      @media (prefers-color-scheme: dark) { .b { background: #18181b; color: #f4f4f5; border-color: #3f3f46; } .muted { color: #a1a1aa !important; } }
      .top { display: flex; align-items: baseline; gap: 8px; }
      .w { font-size: 17px; font-weight: 700; }
      .muted { color: #6b7280; font-size: 12px; }
      .ar { font-size: 18px; margin: 6px 0 4px; direction: rtl; text-align: right; font-weight: 600; }
      .more { direction: rtl; text-align: right; font-size: 13px; }
      .def { margin-top: 6px; } .def i { color: #9333ea; font-style: normal; font-weight: 600; }
      .row { display: flex; gap: 6px; margin-top: 10px; }
      button { font: inherit; border: 1px solid #e5e7eb; background: #f3f4f6; color: inherit; border-radius: 8px; padding: 5px 10px; cursor: pointer; }
      @media (prefers-color-scheme: dark) { button { background: #27272a; border-color: #3f3f46; } }
      button.save { background: #9333ea; border-color: #9333ea; color: #fff; margin-left: auto; }
      button.saved { background: #16a34a; border-color: #16a34a; }
    </style><div class="b"></div>`;
    document.addEventListener("mousedown", (e) => { if (host.isConnected && !e.composedPath().includes(host)) close(); }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); }, true);
  }
  function close() { if (host) host.remove(); }

  const escape = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // 1) Chrome's own translator (on this computer, private, free) – 2) Google Translate as backup.
  // While Chrome downloads its Arabic pack (first use only) we don't make you wait:
  // after a few seconds Google answers this time, and the download goes on in the background.
  let translatorReady = null;
  function chromeTranslator(status) {
    if (!translatorReady) {
      const o = { sourceLanguage: "en", targetLanguage: "ar" };
      translatorReady = Translator.availability(o).then((a) => {
        if (a === "unavailable") throw new Error("unavailable");
        if (a !== "available") status("Downloading the Arabic language pack (only once)…");
        return Translator.create({ ...o, monitor(m) { m.addEventListener("downloadprogress", (e) => status(`Downloading Arabic (${Math.round(e.loaded * 100)}%)…`)); } });
      });
      translatorReady.catch(() => { translatorReady = null; });
    }
    return translatorReady;
  }
  const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));

  async function translate(word, status) {
    if ("Translator" in self) {
      try {
        const t = await Promise.race([chromeTranslator(status), timeout(opts.online ? 4000 : 120000)]);
        const ar = await Promise.race([t.translate(word), timeout(4000)]);
        if (ar) return { ar, more: [], source: "Chrome" };
      } catch {}
    }
    if (!opts.online) return { ar: "", more: [], source: "none" };
    const r = await chrome.runtime.sendMessage({ type: "translate", word });
    return r && !r.error ? { ...r, source: "Google" } : { ar: "", more: [], source: "none" };
  }

  function speak(word) {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-US";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  async function open(word, rect, context) {
    if (!host) build();
    const box = root.querySelector(".b");
    const x = Math.min(scrollX + rect.left, scrollX + document.documentElement.clientWidth - 316);
    const below = rect.bottom + 8 + 220 < innerHeight;
    box.style.left = Math.max(scrollX + 8, x) + "px";
    box.style.top = (below ? scrollY + rect.bottom + 8 : scrollY + rect.top - 8) + "px";
    box.style.transform = below ? "" : "translateY(-100%)";
    box.innerHTML = `<div class="top"><span class="w">${escape(word)}</span><span class="muted ph"></span></div>
      <div class="ar">…</div><div class="more"></div><div class="def"></div>
      <div class="row"><button class="say" title="Pronounce">🔊</button><span class="muted src" style="align-self:center"></span><button class="save">Save</button></div>`;
    document.documentElement.appendChild(host);
    const $ = (s) => box.querySelector(s);
    $(".say").onclick = () => speak(word);
    if (opts.speak) speak(word);

    const card = { word: word.toLowerCase(), context, url: location.href };
    const setSaved = (on) => { $(".save").textContent = on ? "Saved ✓" : "Save"; $(".save").classList.toggle("saved", on); };
    chrome.runtime.sendMessage({ type: "isSaved", word }).then(setSaved);
    $(".save").onclick = async () => {
      const saved = $(".save").classList.contains("saved");
      await chrome.runtime.sendMessage(saved ? { type: "unsave", word } : { type: "save", card });
      setSaved(!saved);
    };

    // the definition and the translation arrive independently – show each when ready
    const defP = (opts.definitions ? chrome.runtime.sendMessage({ type: "define", word }).catch(() => null) : Promise.resolve(null)).then((def) => {
      if (host.isConnected && def && !def.error) {
        $(".ph").textContent = def.phonetic || "";
        $(".def").innerHTML = def.meanings.map((m) => `<div><i>${escape(m.pos)}</i> ${escape(m.def)}${m.example ? `<div class="muted">“${escape(m.example)}”</div>` : ""}</div>`).join("");
      }
      return def;
    });
    const tr = await translate(word, (t) => ($(".ar").textContent = t));
    if (host.isConnected) {
      $(".ar").textContent = tr.ar || (tr.source === "none" ? "Translation not available right now" : "No translation found");
      $(".more").innerHTML = tr.more.map((m) => `<span class="muted">${escape(m.pos)}:</span> ${m.list.map(escape).join("، ")}`).join("<br>");
      $(".src").textContent = tr.source === "Chrome" ? "on-device" : tr.source === "Google" ? "Google" : "";
    }
    const def = await defP;
    Object.assign(card, { ar: tr.ar, more: tr.more, phonetic: def && def.phonetic, meanings: def && def.meanings });
    // if already saved, refresh its meaning
    if ($(".save").classList.contains("saved")) chrome.runtime.sendMessage({ type: "save", card });
  }
})();
