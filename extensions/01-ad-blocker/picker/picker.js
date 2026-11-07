// Element picker: injected only when you click "Hide an element" in the popup.
// Move the mouse to highlight, click to choose, then "Hide" to save the rule.
(() => {
  if (window.__shieldPicker) return;
  window.__shieldPicker = true;

  const host = document.createElement("shield-picker");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      .box { position: fixed; background: rgba(220,38,38,.25); outline: 2px solid #dc2626; pointer-events: none; transition: all .05s; }
      .panel { position: fixed; right: 16px; bottom: 16px; width: 360px; pointer-events: auto;
        font: 13px system-ui, sans-serif; background: #18181b; color: #f4f4f5; border-radius: 12px;
        padding: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.4); }
      .panel b { display: block; margin-bottom: 6px; }
      textarea { width: 100%; box-sizing: border-box; height: 54px; font: 12px ui-monospace, monospace;
        background: #27272a; color: #f4f4f5; border: 1px solid #3f3f46; border-radius: 8px; padding: 6px; }
      .row { display: flex; gap: 6px; margin-top: 8px; align-items: center; }
      button { font: inherit; border: 1px solid #3f3f46; background: #27272a; color: #f4f4f5; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
      button.go { background: #dc2626; border-color: #dc2626; }
      .n { margin-left: auto; color: #a1a1aa; font-size: 12px; }
    </style>
    <div class="box" hidden></div>
    <div class="panel">
      <b>Shield – hide an element</b>
      <div class="hint">Hover and click the thing you want gone. <kbd>Esc</kbd> to cancel.</div>
      <textarea spellcheck="false" hidden></textarea>
      <div class="row" hidden>
        <button data-a="wider" title="Select the parent element">Wider</button>
        <button data-a="narrower">Narrower</button>
        <span class="n"></span>
      </div>
      <div class="row">
        <button class="go" data-a="hide" hidden>Hide</button>
        <button data-a="cancel">Cancel</button>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const box = root.querySelector(".box");
  const panel = root.querySelector(".panel");
  const ta = root.querySelector("textarea");
  const rows = root.querySelectorAll(".row");
  const hideBtn = root.querySelector("[data-a=hide]");
  const count = root.querySelector(".n");
  let chosen = null;   // element picked by click
  let chain = [];      // chosen + ancestors, for Wider/Narrower
  let level = 0;

  function cssEscape(s) { return CSS.escape(s); }

  // ids/classes that look auto-generated (long digits / hashes) make bad rules
  const stable = (s) => s && !/\d{4,}|^[a-z0-9]{12,}$/i.test(s) && s.length < 40;

  function segment(el) {
    if (stable(el.id)) return "#" + cssEscape(el.id);
    let s = el.localName;
    const cls = [...el.classList].filter(stable).slice(0, 3);
    if (cls.length) s += cls.map((c) => "." + cssEscape(c)).join("");
    return s;
  }

  function selectorFor(el) {
    const parts = [];
    for (let e = el; e && e !== document.documentElement && parts.length < 4; e = e.parentElement) {
      const seg = segment(e);
      parts.unshift(seg);
      if (seg.startsWith("#")) break;
      try { if (document.querySelectorAll(parts.join(" > ")).length === 1) break; } catch {}
    }
    return parts.join(" > ");
  }

  function highlight(el) {
    if (!el) { box.hidden = true; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    box.hidden = false;
  }

  function updateCount() {
    try { count.textContent = document.querySelectorAll(ta.value).length + " match(es)"; }
    catch { count.textContent = "invalid selector"; }
  }

  function choose(el) {
    chosen = el;
    ta.value = selectorFor(el);
    ta.hidden = false;
    rows[0].hidden = false;
    hideBtn.hidden = false;
    highlight(el);
    updateCount();
  }

  function onMove(e) {
    if (chosen) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== host) highlight(el);
  }

  function onClick(e) {
    if (e.composedPath().includes(panel)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === host) return;
    chain = [];
    for (let x = el; x && x !== document.body; x = x.parentElement) chain.push(x);
    level = 0;
    choose(el);
  }

  function stop() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    host.remove();
    window.__shieldPicker = false;
  }

  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); stop(); } }

  ta.addEventListener("input", updateCount);
  root.addEventListener("click", async (e) => {
    const a = e.target.dataset && e.target.dataset.a;
    if (a === "cancel") stop();
    if (a === "wider" && level < chain.length - 1) choose(chain[++level]);
    if (a === "narrower" && level > 0) choose(chain[--level]);
    if (a === "hide") {
      const selector = ta.value.trim();
      try { document.querySelectorAll(selector); } catch { return; }
      const style = document.createElement("style");
      style.textContent = `${selector}{display:none!important}`;
      document.documentElement.appendChild(style);
      await chrome.runtime.sendMessage({ type: "addUserFilter", host: location.hostname.replace(/^www\./, ""), selector });
      stop();
    }
  });

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
})();
