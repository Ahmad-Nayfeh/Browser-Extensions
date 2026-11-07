// Trace – watches what YOU do on the page and what the page does in return.
// Only active in the tab being recorded; everything else gets a "no" at hello.
(() => {
  if (window.__traceCapture) return;
  window.__traceCapture = true;

  const clip = (s, n = 80) => { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  let opts = {};
  let active = false;
  const send = (ev) => { if (active) chrome.runtime.sendMessage({ type: "trace", ev: { t: Date.now(), url: location.href, ...ev } }).catch(() => {}); };

  // ---------- describing elements ----------
  function selector(el) {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.body && parts.length < 4; e = e.parentElement) {
      let s = e.localName;
      if (e.id && !/\d{3,}/.test(e.id)) { parts.unshift(`${s}#${e.id}`); break; }
      const cls = [...e.classList].filter((c) => c.length < 25 && !/\d{3,}|^(is|has)-/.test(c)).slice(0, 2);
      if (cls.length) s += "." + cls.join(".");
      parts.unshift(s);
    }
    return parts.join(" > ");
  }
  function labelOf(el) {
    if (el.labels && el.labels[0]) return clip(el.labels[0].innerText, 50);
    return clip(el.getAttribute("aria-label") || el.placeholder || el.name || el.title || el.id, 50);
  }
  function describe(el) {
    const tag = el.localName;
    const d = { tag, sel: selector(el) };
    const text = clip(el.getAttribute("aria-label") || el.innerText || el.value || el.alt || el.title, 70);
    if (text) d.text = text;
    if (tag === "a" && el.getAttribute("href")) d.href = clip(el.href, 120);
    if (tag === "input") d.inputType = el.type;
    if (el.disabled) d.disabled = true;
    return d;
  }
  const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [onclick], [tabindex]";

  // ---------- privacy ----------
  const SECRET = /pass|pwd|card|cvv|cvc|ssn|secret|token|otp|pin\b|iban|security/i;
  function valueOf(el) {
    if (el.type === "checkbox" || el.type === "radio") return el.checked ? "checked" : "unchecked";
    if (el.localName === "select") return clip(el.selectedOptions[0] ? el.selectedOptions[0].text : el.value, 60);
    const v = el.value || el.innerText || "";
    const secret = el.type === "password" || /cc-|one-time-code|password/.test(el.autocomplete || "") || SECRET.test(`${el.name} ${el.id} ${el.getAttribute("aria-label") || ""}`);
    if (secret) return `•••• (hidden, ${v.length} chars)`;
    if (opts.maskAll) return `(typed ${v.length} chars)`;
    return clip(v, 120);
  }

  // ---------- page changes after each action ----------
  const NOTABLE = /modal|dialog|toast|alert|error|snackbar|notification|popup|popover|tooltip|dropdown|menu|banner|message|warning|invalid/i;
  const ERRORISH = /error|failed|failure|invalid|wrong|not found|denied|unauthori[sz]ed|forbidden|exception|try again|خطأ|فشل|غير صحيح/i;
  let added = 0, removed = 0, appeared = [], windowTimer = null, lastHref = location.href;

  function noteNode(n) {
    if (n.nodeType !== 1 || appeared.length >= 6) return;
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const text = clip(n.innerText, 140);
    const role = n.getAttribute("role") || "";
    const notable = /alert|dialog|status|alertdialog|tooltip|menu/.test(role) || NOTABLE.test(n.className && n.className.baseVal === undefined ? n.className : "") || n.localName === "dialog";
    if ((notable && text) || (text && ERRORISH.test(text))) appeared.push({ el: selector(n), text, error: ERRORISH.test(text) });
  }

  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "childList") {
        added += m.addedNodes.length;
        removed += m.removedNodes.length;
        m.addedNodes.forEach(noteNode);
      } else if (m.type === "attributes" && m.target.nodeType === 1) {
        const t = m.target;
        if ((m.attributeName === "open" && t.hasAttribute("open")) || (m.attributeName === "aria-hidden" && t.getAttribute("aria-hidden") === "false") || (m.attributeName === "hidden" && !t.hidden)) noteNode(t);
      }
    }
    if (location.href !== lastHref) { lastHref = location.href; setTimeout(snapshot, 1200); }
  });

  // after an action, collect changes for 1.5 s, then report them as one line
  function afterAction() {
    clearTimeout(windowTimer);
    added = removed = 0; appeared = [];
    windowTimer = setTimeout(() => {
      windowTimer = null;
      if (added || removed || appeared.length) send({ type: "dom", added, removed, appeared });
      added = removed = 0; appeared = [];
      checkSoon();
    }, 1500);
  }
  // big changes nobody clicked for (timers, live updates): summarized every 10 s
  setInterval(() => {
    if (!active || windowTimer) return;
    if (appeared.length || added > 30) send({ type: "dom", added, removed, appeared, background: true });
    added = removed = 0; appeared = [];
  }, 10000);

  // ---------- user actions ----------
  function onClick(e) {
    const el = e.target.closest ? e.target.closest(INTERACTIVE) || e.target : e.target;
    send({ type: e.type === "dblclick" ? "dblclick" : "click", target: describe(el), x: Math.round(e.clientX), y: Math.round(e.clientY) });
    afterAction();
  }
  const typingTimers = new WeakMap(), lastSent = new WeakMap();
  // one line per field: sent when you stop typing (or leave the field), never twice for the same value
  function sendValue(el) {
    clearTimeout(typingTimers.get(el));
    typingTimers.delete(el);
    const v = valueOf(el);
    if (lastSent.get(el) === v) return;
    lastSent.set(el, v);
    send({ type: "input", field: { ...describe(el), label: labelOf(el) }, value: v });
  }
  function onInput(e) {
    const el = e.target;
    if (!el || !/^(input|textarea|select)$/.test(el.localName) && !el.isContentEditable) return;
    if (e.type === "input" && el.localName !== "select" && el.type !== "checkbox" && el.type !== "radio") {
      clearTimeout(typingTimers.get(el)); // wait until you stop typing
      typingTimers.set(el, setTimeout(() => sendValue(el), 900));
      return;
    }
    if (e.type === "change") { sendValue(el); afterAction(); }
  }
  function onSubmit(e) {
    const f = e.target;
    send({ type: "submit", form: { sel: selector(f), action: f.getAttribute("action") || "(same page)", method: (f.method || "get").toUpperCase() } });
    afterAction();
  }
  function onKey(e) {
    const combo = (e.ctrlKey || e.metaKey) && e.key.length === 1;
    if (!["Enter", "Escape", "Tab"].includes(e.key) && !combo) return;
    const k = `${e.ctrlKey ? "Ctrl+" : ""}${e.metaKey ? "Cmd+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${e.key.length === 1 ? e.key.toUpperCase() : e.key}`;
    send({ type: "key", key: k, target: describe(e.target) });
    afterAction();
  }
  let scrollTimer = null, lastScroll = 0;
  function onScroll() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const h = document.documentElement.scrollHeight - innerHeight;
      const y = Math.round(scrollY);
      if (Math.abs(y - lastScroll) < 50) return; // same place as before (pages reset to the top)
      lastScroll = y;
      send({ type: "scroll", y, percent: h > 0 ? Math.round((scrollY / h) * 100) : 0 });
    }, 700);
  }
  let resizeTimer = null;
  function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => send({ type: "resize", w: innerWidth, h: innerHeight }), 700); }

  // messages from hook-main.js (page world)
  function onPageEvent(e) {
    let ev; try { ev = JSON.parse(e.detail); } catch { return; }
    if (ev.type === "console" && (ev.level === "log" || ev.level === "info") && !opts.logs) return;
    send(ev);
  }

  // ---------- automatic visual checks ----------
  // Things that look broken to a human but throw no error.
  const reported = new Set(); // same problem on the same page is reported once
  function textInside(el) { for (const c of el.childNodes) if (c.nodeType === 3 && c.textContent.trim()) return true; return false; }
  function luminance(c) {
    const m = c.match(/rgba?\(([\d.]+),?\s*([\d.]+),?\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?/);
    if (!m || (m[4] !== undefined && +m[4] < 0.5)) return null;
    const [r, g, b] = [m[1], m[2], m[3]].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function bgLum(el) {
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage !== "none") return null; // text on a picture: can't judge
      const l = luminance(s.backgroundColor);
      if (l !== null) return l;
    }
    return 1; // page default: white
  }
  // is the point inside every scroll/overflow box around the element? (if not, it is
  // simply scrolled out of view inside that box – normal, not a bug)
  function visibleInAncestors(el, x, y) {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX + s.overflowY)) {
        const r = a.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
      }
    }
    return true;
  }
  // text hidden on purpose: screen-reader-only labels, "line-clamp" previews ending in "…"
  function cutOnPurpose(el, s) {
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2 || /sr-only|visually-hidden|screen-reader/.test(el.className)) return true;
    if (s.clip !== "auto" && s.clip !== "" || s.clipPath !== "none") return true;
    if (s.webkitLineClamp && s.webkitLineClamp !== "none") return true;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const as = getComputedStyle(a);
      if (as.textOverflow === "ellipsis" || (as.webkitLineClamp && as.webkitLineClamp !== "none")) return true;
    }
    return false;
  }
  const uniq = (list) => [...new Set(list)];

  function visualIssues() {
    const out = [];
    const W = document.documentElement.clientWidth;
    const all = [...document.body.querySelectorAll("*")].slice(0, 5000);
    // 1. the page is wider than the window
    if (document.documentElement.scrollWidth > W + 2) {
      const wide = all.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > W + 2 && getComputedStyle(el).position !== "fixed"; });
      const outer = wide.filter((el) => !wide.some((o) => o !== el && o.contains(el)));
      out.push({ kind: "overflow", text: `Page is wider than the window (${document.documentElement.scrollWidth}px > ${W}px): sideways scrolling`, els: outer.slice(0, 4).map(selector) });
    }
    // 2. broken images
    const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src) && i.getBoundingClientRect().width > 0);
    if (broken.length) out.push({ kind: "broken-image", text: `${broken.length} broken image(s)`, els: broken.slice(0, 5).map((i) => clip(i.currentSrc || i.src, 100)) });
    // 3. buttons/links you can't click because something covers them
    const covered = [];
    for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button]")) {
      if (covered.length >= 5) break;
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6 || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > W) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.pointerEvents === "none" || +s.opacity === 0) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (!visibleInAncestors(el, cx, cy)) continue;
      const hit = document.elementFromPoint(cx, cy);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !(el.labels && [...el.labels].some((l) => l.contains(hit)))) covered.push(`${selector(el)} "${clip(el.innerText || el.value || el.getAttribute("aria-label"), 30)}" is under ${selector(hit)}`);
    }
    if (covered.length) out.push({ kind: "covered", text: "Clickable element(s) covered by another element", els: uniq(covered) });
    // 4. text that is cut off
    const cut = [];
    for (const el of all) {
      if (cut.length >= 5) break;
      if (!textInside(el)) continue;
      const s = getComputedStyle(el);
      if (!/hidden|clip/.test(s.overflowX + s.overflowY) || cutOnPurpose(el, s)) continue;
      if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) cut.push(`${selector(el)} "${clip(el.innerText, 50)}"`);
    }
    if (cut.length) out.push({ kind: "clipped", text: "Text cut off (doesn't fit its box)", els: uniq(cut) });
    // 5. text that is hard to read (contrast below 3:1)
    const low = [];
    for (const el of all) {
      if (low.length >= 5) break;
      if (!textInside(el)) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || +s.opacity < 0.5 || el.getBoundingClientRect().width <= 2) continue;
      const fg = luminance(s.color), bg = bgLum(el);
      if (fg === null || bg === null) continue;
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      if (ratio < 3) low.push(`${selector(el)} "${clip(el.innerText, 40)}" contrast ${ratio.toFixed(1)}:1`);
    }
    if (low.length) out.push({ kind: "contrast", text: "Hard-to-read text (low contrast)", els: uniq(low) });
    // 6. buttons/links with no text or label
    const empty = [...document.querySelectorAll("button, a[href]")].filter((b) => b.getBoundingClientRect().width > 0 && !(b.innerText.trim() || b.getAttribute("aria-label") || b.title || b.querySelector("img[alt], svg title")));
    if (empty.length) out.push({ kind: "unlabeled", text: `${empty.length} button(s)/link(s) without any text or label`, els: empty.slice(0, 5).map(selector) });

    const fresh = out.filter((i) => { const k = location.href + i.kind + i.els.join(); if (reported.has(k)) return false; reported.add(k); return true; });
    if (fresh.length) send({ type: "visual", issues: fresh });
  }
  const checkSoon = () => { if (opts.visual !== false) setTimeout(() => { try { visualIssues(); } catch {} }, 300); };

  // ---------- page snapshot ----------
  const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/;
  const KEEP = /^(id|class|href|src|alt|role|type|name|placeholder|for|action|method|value|disabled|required|checked|selected|aria-[a-z]+|data-testid)$/;
  function skeleton(limit) {
    let out = "", cut = false;
    const ser = (n, d) => {
      if (cut) return;
      if (out.length > limit) { cut = true; return; }
      if (n.nodeType === 3) { const t = n.textContent.replace(/\s+/g, " ").trim(); if (t) out += "  ".repeat(d) + clip(t, 100) + "\n"; return; }
      if (n.nodeType !== 1 || /^(script|style|noscript|template|link|meta)$/.test(n.localName)) return;
      if (n.localName === "input" && n.type === "password") { out += `${"  ".repeat(d)}<input type="password" ${n.name ? `name="${n.name}"` : ""}>\n`; return; }
      const attrs = [...n.attributes].filter((a) => KEEP.test(a.name) && !(a.name === "value" && SECRET.test(n.name + n.id))).map((a) => ` ${a.name}="${clip(a.value, 100).replace(/"/g, "&quot;")}"`).join("");
      if (n.localName === "svg") { out += `${"  ".repeat(d)}<svg${attrs}>…</svg>\n`; return; }
      const kids = [...n.childNodes].filter((c) => c.nodeType === 1 || (c.nodeType === 3 && c.textContent.trim()));
      if (VOID.test(n.localName)) { out += `${"  ".repeat(d)}<${n.localName}${attrs}>\n`; return; } // <img>, <input>… have no closing tag
      if (!kids.length) { out += `${"  ".repeat(d)}<${n.localName}${attrs}></${n.localName}>\n`; return; }
      if (kids.length === 1 && kids[0].nodeType === 3) { out += `${"  ".repeat(d)}<${n.localName}${attrs}>${clip(kids[0].textContent, 100)}</${n.localName}>\n`; return; }
      out += `${"  ".repeat(d)}<${n.localName}${attrs}>\n`;
      kids.forEach((c) => ser(c, d + 1));
      out += `${"  ".repeat(d)}</${n.localName}>\n`;
    };
    if (document.body) ser(document.body, 0);
    return out + (cut ? "<!-- … cut: page is very large -->\n" : "");
  }
  let snapped = new Set();
  function snapshot() {
    if (!active || snapped.has(location.href) || !document.body) return;
    snapped.add(location.href);
    const headings = [...document.querySelectorAll("h1, h2, h3")].slice(0, 25).map((h) => `${h.localName}: ${clip(h.innerText, 80)}`);
    send({ type: "page", title: document.title, headings, html: opts.html === false ? "" : skeleton(opts.htmlLimit || 60000) });
    checkSoon();
  }

  // ---------- start / stop ----------
  function start(o) {
    opts = o || {};
    active = true;
    document.addEventListener("click", onClick, true);
    document.addEventListener("dblclick", onClick, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("__trace", onPageEvent);
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onResize);
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "hidden", "aria-hidden"] });
    if (document.readyState === "complete") setTimeout(snapshot, 800);
    else addEventListener("load", () => setTimeout(snapshot, 800), { once: true });
  }
  function stop() {
    active = false;
    mo.disconnect();
    document.dispatchEvent(new CustomEvent("__trace_stop"));
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onClick, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onInput, true);
    document.removeEventListener("submit", onSubmit, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("__trace", onPageEvent);
    removeEventListener("scroll", onScroll);
    removeEventListener("resize", onResize);
  }
  document.addEventListener("__trace_capture_stop", stop);

  // events from the page world can arrive before the answer – keep them for a moment
  const early = [];
  const keepEarly = (e) => early.push(e);
  document.addEventListener("__trace", keepEarly);
  chrome.runtime.sendMessage({ type: "trace-hello" }).then((r) => {
    document.removeEventListener("__trace", keepEarly);
    if (!r || !r.recording) { document.dispatchEvent(new CustomEvent("__trace_stop")); return; }
    start(r.opts);
    early.forEach(onPageEvent);
  }).catch(() => {});
})();
