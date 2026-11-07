// Blueprint – page analyzer. Injected only when you click "Analyze".
// window.__bp.sheetsToFetch() → stylesheet URLs the page can't read (other domains)
// window.__bp.run(fetched, tech, opts) → { md, stats }
(() => {
  if (window.__bp) return;

  const MAX_ELEMENTS = 6000;   // style sweep limit – keeps huge pages fast
  const vw = document.documentElement.clientWidth;
  const vh = innerHeight;

  // ---------- small helpers ----------
  const cs = (el) => getComputedStyle(el);
  const px = (v) => Math.round(parseFloat(v) || 0);
  const round = (n) => Math.round(n);
  const clip = (s, n = 80) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const count = (map, key, w = 1) => { if (key !== undefined && key !== null && key !== "") map.set(key, (map.get(key) || 0) + w); };
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const pct = (part, total) => (total ? Math.round((part / total) * 100) : 0);
  const fence = (lang, s) => "```" + lang + "\n" + s.trim() + "\n```";

  function hex(c) {
    const m = c && c.match(/^rgba?\(([\d.]+),?\s*([\d.]+),?\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\)$/);
    if (!m) return c || "";
    let a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4];
    const h = (n) => Math.round(+n).toString(16).padStart(2, "0");
    return "#" + h(m[1]) + h(m[2]) + h(m[3]) + (a < 1 ? h(a * 255) : "");
  }
  const transparent = (c) => !c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);

  function visible(el, s = cs(el)) {
    if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function label(el) {
    let s = el.localName;
    if (el.id && el.id.length < 40) s += "#" + el.id;
    const cls = [...el.classList].filter((c) => c.length < 30).slice(0, 3);
    if (cls.length) s += "." + cls.join(".");
    return s;
  }

  function textOf(el, n = 60) {
    return clip(el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("alt") || el.getAttribute("title") || "", n);
  }

  // ---------- stylesheets ----------
  function readableSheets() {
    const out = [], blocked = [];
    const all = [...document.styleSheets, ...(document.adoptedStyleSheets || [])];
    for (const sh of all) {
      try { sh.cssRules; out.push({ href: sh.href || location.href, sheet: sh, inline: !sh.href }); }
      catch { if (sh.href) blocked.push(sh.href); }
    }
    return { out, blocked };
  }

  function sheetsToFetch() { return readableSheets().blocked; }

  function parseSheets(fetched) {
    const { out } = readableSheets();
    const sheets = [...out];
    for (const f of fetched || []) {
      if (!f.text) continue;
      try { const sh = new CSSStyleSheet({ baseURL: f.href }); sh.replaceSync(f.text); sheets.push({ href: f.href, sheet: sh, text: f.text }); } catch {}
    }
    const rules = [], keyframes = [], fontFaces = [], media = new Map(), rootVars = new Map(), layers = new Set(), containers = new Set();
    let ruleCount = 0;
    const walk = (list, base, cond) => {
      for (const r of list) {
        ruleCount++;
        if (r instanceof CSSStyleRule) {
          rules.push({ sel: r.selectorText, style: r.style, media: cond });
          if (/(^|,)\s*(:root|html|:host|body)\s*(,|$)/.test(r.selectorText)) {
            for (const p of r.style) if (p.startsWith("--")) rootVars.set(p, r.style.getPropertyValue(p).trim());
          }
          if (r.cssRules && r.cssRules.length) walk(r.cssRules, base, cond); // CSS nesting
        } else if (r instanceof CSSMediaRule) {
          const c = r.conditionText || r.media.mediaText;
          const m = media.get(c) || { rules: 0, sample: new Set() };
          m.rules += r.cssRules.length;
          for (const x of r.cssRules) if (x.selectorText && m.sample.size < 6) m.sample.add(clip(x.selectorText, 50));
          media.set(c, m);
          walk(r.cssRules, base, c);
        } else if (r instanceof CSSKeyframesRule) {
          keyframes.push({ name: r.name, css: r.cssText });
        } else if (r instanceof CSSFontFaceRule) {
          const st = r.style;
          const src = (st.getPropertyValue("src") || "").replace(/url\(["']?([^"')]+)["']?\)/g, (_, u) => { try { return `url(${new URL(u, base).href})`; } catch { return `url(${u})`; } });
          fontFaces.push({ family: st.getPropertyValue("font-family").replace(/["']/g, ""), weight: st.getPropertyValue("font-weight") || "400", style: st.getPropertyValue("font-style") || "normal", display: st.getPropertyValue("font-display"), src });
        } else if (typeof CSSLayerBlockRule !== "undefined" && r instanceof CSSLayerBlockRule) {
          layers.add(r.name); walk(r.cssRules, base, cond);
        } else if (typeof CSSContainerRule !== "undefined" && r instanceof CSSContainerRule) {
          containers.add(r.conditionText || r.containerQuery); walk(r.cssRules, base, cond);
        } else if (r.cssRules) {
          walk(r.cssRules, base, cond); // @supports, @document…
        }
      }
    };
    for (const s of sheets) { try { walk(s.sheet.cssRules, s.href); } catch {} }

    const fullCss = sheets.map((s) => {
      let text = s.text;
      if (!text) { try { text = [...s.sheet.cssRules].map((r) => r.cssText).join("\n"); } catch { text = ""; } }
      return { href: s.inline ? "(inline <style>)" : s.href, text };
    });
    return { rules, keyframes, fontFaces, media, rootVars, layers, containers, ruleCount, fullCss, sheetCount: sheets.length };
  }

  // ---------- style sweep over visible elements ----------
  function sweep() {
    const all = document.body ? document.body.querySelectorAll("*") : [];
    const els = [];
    for (const el of all) {
      if (els.length >= MAX_ELEMENTS) break;
      if (/^(script|style|noscript|template|head|meta|link|br|wbr)$/.test(el.localName)) continue;
      if (el.closest("svg") && el.localName !== "svg") continue;
      const s = cs(el);
      if (!visible(el, s)) continue;
      els.push({ el, s, r: el.getBoundingClientRect() });
    }
    return { els, total: all.length };
  }

  function directText(el) {
    let n = 0;
    for (const c of el.childNodes) if (c.nodeType === 3) n += c.textContent.trim().length;
    return n;
  }

  function tokens(els) {
    const text = new Map(), bg = new Map(), border = new Map(), gradients = new Map();
    const families = new Map(), sizes = new Map(), weights = new Map(), lineHeights = new Map();
    const spacing = new Map(), radii = new Map(), shadows = new Map(), borders = new Map(), zs = new Map(), transitions = new Map(), animations = new Map();
    const widths = new Map();
    let textTotal = 0, bgTotal = 0;
    for (const { el, s, r } of els) {
      const t = directText(el);
      if (t) {
        count(text, hex(s.color), t); textTotal += t;
        count(families, s.fontFamily, t); count(sizes, px(s.fontSize), t); count(weights, s.fontWeight, t);
        count(lineHeights, s.lineHeight === "normal" ? "normal" : (parseFloat(s.lineHeight) / parseFloat(s.fontSize)).toFixed(2), t);
      }
      if (!transparent(s.backgroundColor)) { const a = r.width * r.height; count(bg, hex(s.backgroundColor), a); bgTotal += a; }
      if (s.backgroundImage.includes("gradient")) count(gradients, clip(s.backgroundImage, 160));
      const bw = px(s.borderTopWidth) || px(s.borderBottomWidth) || px(s.borderLeftWidth);
      if (bw && s.borderTopStyle !== "none") {
        count(border, hex(s.borderTopColor || s.borderBottomColor));
        count(borders, `${bw}px ${s.borderTopStyle !== "none" ? s.borderTopStyle : s.borderBottomStyle}`);
      }
      for (const p of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginBottom", "rowGap", "columnGap"]) {
        const v = px(s[p]); if (v > 0 && v < 400) count(spacing, v);
      }
      const rad = s.borderRadius; if (rad && rad !== "0px") count(radii, rad);
      if (s.boxShadow !== "none") count(shadows, s.boxShadow);
      if (s.zIndex !== "auto") count(zs, s.zIndex);
      if (s.transitionDuration !== "0s") count(transitions, `${s.transitionProperty} ${s.transitionDuration} ${s.transitionTimingFunction}`);
      if (s.animationName !== "none") count(animations, `${s.animationName} ${s.animationDuration} ${s.animationTimingFunction} ${s.animationIterationCount}`);
      if (s.maxWidth !== "none" && s.marginLeft === s.marginRight && px(s.marginLeft) > 0 && r.width > vw * 0.4) count(widths, s.maxWidth);
    }
    return { text, bg, border, gradients, families, sizes, weights, lineHeights, spacing, radii, shadows, borders, zs, transitions, animations, widths, textTotal, bgTotal };
  }

  // ---------- typography per element type ----------
  function typography(els) {
    const tags = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "button", "li", "label", "small", "input", "blockquote", "code", "nav a", "footer"];
    const rows = [];
    for (const tag of tags) {
      const combos = new Map();
      const list = tag === "nav a" ? document.querySelectorAll("nav a") : tag === "footer" ? document.querySelectorAll("footer p, footer a, footer li") : document.getElementsByTagName(tag);
      let n = 0;
      for (const el of list) {
        if (n++ > 300) break;
        const s = cs(el);
        if (!visible(el, s)) continue;
        const k = [s.fontFamily.split(",")[0].replace(/["']/g, ""), px(s.fontSize) + "px", s.fontWeight, s.lineHeight, s.letterSpacing, s.textTransform, hex(s.color)].join(" | ");
        count(combos, k);
      }
      const best = top(combos, 1)[0];
      if (best) rows.push(`| ${tag} | ${best[0]} | ${best[1]} |`);
    }
    return rows.length ? "| Element | Font | Size | Weight | Line height | Letter spacing | Transform | Color | Count |\n|---|---|---|---|---|---|---|---|---|\n" + rows.join("\n") : "_No text found._";
  }

  // ---------- page structure (text wireframe) ----------
  const SEMANTIC = /^(header|nav|main|section|article|aside|footer|form|dialog|figure|table|ul|ol)$/;
  function layoutDesc(el, s) {
    const parts = [];
    if (s.display.includes("grid")) {
      const cols = s.gridTemplateColumns !== "none" ? s.gridTemplateColumns.split(/\s+(?![^(]*\))/).length : 1;
      parts.push(`grid ${cols} col${cols > 1 ? "s" : ""} (${clip(s.gridTemplateColumns, 60)})${px(s.columnGap) || px(s.rowGap) ? ` gap ${px(s.rowGap)}/${px(s.columnGap)}px` : ""}`);
    } else if (s.display.includes("flex")) {
      parts.push(`flex ${s.flexDirection}${s.flexWrap === "wrap" ? " wrap" : ""}${s.justifyContent !== "normal" ? " justify:" + s.justifyContent : ""}${s.alignItems !== "normal" ? " align:" + s.alignItems : ""}${px(s.columnGap) || px(s.rowGap) ? ` gap ${px(s.rowGap)}/${px(s.columnGap)}px` : ""}`);
    }
    if (/sticky|fixed/.test(s.position)) parts.push(`**${s.position}** top:${s.top}`);
    const pad = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(px);
    if (pad.some(Boolean)) parts.push(`padding ${pad.join(" ")}`);
    if (s.maxWidth !== "none") parts.push(`max-width ${s.maxWidth}`);
    if (!transparent(s.backgroundColor)) parts.push(`bg ${hex(s.backgroundColor)}`);
    if (s.backgroundImage !== "none") parts.push(s.backgroundImage.includes("gradient") ? "bg gradient" : "bg image");
    if (s.borderRadius !== "0px") parts.push(`radius ${s.borderRadius}`);
    if (s.boxShadow !== "none") parts.push("shadow");
    return parts.join(" · ");
  }
  function contentDesc(el) {
    const h = el.querySelector("h1, h2, h3, h4");
    const n = (sel) => el.querySelectorAll(sel).length;
    const bits = [];
    if (h) bits.push(`"${clip(h.innerText, 60)}"`);
    const b = n("button, [role=button], input[type=submit]"), a = n("a[href]"), i = n("img, picture, svg, video"), f = n("input, textarea, select");
    if (b) bits.push(`${b} button${b > 1 ? "s" : ""}`);
    if (a) bits.push(`${a} link${a > 1 ? "s" : ""}`);
    if (i) bits.push(`${i} image/icon${i > 1 ? "s" : ""}`);
    if (f) bits.push(`${f} field${f > 1 ? "s" : ""}`);
    if (!h && !bits.length) bits.push(`"${clip(el.innerText, 60)}"`);
    return bits.join(", ");
  }
  function significant(el, s, r) {
    if (SEMANTIC.test(el.localName)) return true;
    if ((s.display.includes("grid") || s.display.includes("flex")) && [...el.children].filter((c) => visible(c)).length >= 2 && r.width > 200) return true;
    return r.width >= vw * 0.5 && r.height >= 60 && (!transparent(s.backgroundColor) || s.backgroundImage !== "none" || px(s.paddingTop) >= 24);
  }
  function structure() {
    const lines = [];
    let nodes = 0;
    const walk = (el, depth) => {
      for (const c of el.children) {
        if (nodes > 260) return;
        if (/^(script|style|noscript|template|svg|img|picture|video|canvas|iframe|br)$/.test(c.localName)) continue;
        const s = cs(c);
        if (!visible(c, s)) continue;
        const r = c.getBoundingClientRect();
        if (significant(c, s, r) && depth < 7) {
          nodes++;
          const pos = `${round(r.width)}×${round(r.height)} at y=${round(r.top + scrollY)}`;
          const lay = layoutDesc(c, s);
          lines.push(`${"  ".repeat(depth)}- **${label(c)}** — ${pos}${lay ? " · " + lay : ""} · ${contentDesc(c)}`);
          walk(c, depth + 1);
        } else {
          walk(c, depth); // a plain wrapper: look inside without adding a level
        }
      }
    };
    walk(document.body, 0);
    return lines.join("\n") || "_No structure found._";
  }

  // ---------- components ----------
  const CSS_PROPS = ["display", "position", "height", "min-width", "padding", "gap", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-transform", "text-decoration-line", "text-align", "color", "background-color", "background-image", "border", "border-bottom", "border-radius", "box-shadow", "outline", "opacity", "cursor", "transition", "align-items", "justify-content", "object-fit", "aspect-ratio", "backdrop-filter"];
  const DEFAULTS = { "position": "static", "background-image": "none", "box-shadow": "none", "opacity": "1", "cursor": "auto", "text-transform": "none", "letter-spacing": "normal", "text-decoration-line": "none", "gap": "normal", "align-items": "normal", "justify-content": "normal", "object-fit": "fill", "aspect-ratio": "auto", "backdrop-filter": "none", "min-width": "auto", "transition": "all 0s ease 0s", "text-align": "start" };
  const ALSO_DEFAULT = { "transition": ["all", "all 0s"], "min-width": ["0px"] };
  function cssBlock(el, s) {
    const lines = [];
    for (const p of CSS_PROPS) {
      let v = s.getPropertyValue(p);
      if (!v || DEFAULTS[p] === v || (ALSO_DEFAULT[p] && ALSO_DEFAULT[p].includes(v))) continue;
      if (p === "border" && (v.startsWith("0px") || v.includes("none"))) continue;
      if (p === "border-bottom" && (s.getPropertyValue("border") === v || v.startsWith("0px") || v.includes("none"))) continue;
      if (p === "outline" && (v.includes("none") || v.startsWith("0px"))) continue;
      if (p === "background-color" && transparent(v)) continue;
      if (p === "padding" && v === "0px") continue;
      if (p === "border-radius" && v === "0px") continue;
      if (p === "height" && !/^(button|input|select|a)$/.test(el.localName)) continue;
      if (p === "font-family") v = v.split(",").slice(0, 3).join(",");
      if (/color$/.test(p)) v = hex(v);
      lines.push(`  ${p}: ${clip(v, 140)};`);
    }
    return lines.join("\n");
  }
  const STATE = /:(hover|focus-visible|focus-within|focus|active|disabled|checked|visited)\b/g;
  function splitSelectors(sel) { // split "a, b:is(c, d)" at top-level commas
    const out = []; let depth = 0, cur = "";
    for (const ch of sel) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && !depth) { out.push(cur); cur = ""; } else cur += ch; }
    out.push(cur); return out.map((x) => x.trim()).filter(Boolean);
  }
  function stateRules(el, rules) {
    const found = [];
    for (const r of rules) {
      if (!STATE.test(r.sel)) { STATE.lastIndex = 0; continue; }
      STATE.lastIndex = 0;
      for (const part of splitSelectors(r.sel)) {
        const states = part.match(STATE);
        if (!states) continue;
        const base = part.replace(STATE, "").replace(/::?(before|after)\b/, "").trim() || "*";
        let ok = false;
        try { ok = el.matches(base); } catch {}
        if (ok) {
          const line = `${part.trim()} { ${clip(r.style.cssText, 300)} }${r.media ? `  /* @media ${r.media} */` : ""}`;
          if (!found.includes(line)) found.push(line); // sites often load the same CSS twice
          break;
        }
      }
      if (found.length >= 8) break;
    }
    return found;
  }
  function components(rules) {
    const kinds = {
      "Buttons": [...document.querySelectorAll("button, [role=button], input[type=submit], input[type=button], a")].filter((el) => {
        if (el.localName !== "a") return true;
        const s = cs(el);
        return (!transparent(s.backgroundColor) || px(s.borderTopWidth) > 0) && px(s.paddingLeft) >= 8;
      }),
      "Text links": [...document.querySelectorAll("p a, li a, main a, article a")].filter((el) => { const s = cs(el); return transparent(s.backgroundColor) && px(s.paddingLeft) < 8; }),
      "Text fields": [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=range]), textarea, select")],
      "Checkboxes & radios": [...document.querySelectorAll("input[type=checkbox], input[type=radio], [role=checkbox], [role=switch]")],
      "Cards": [...document.querySelectorAll("div, article, li, a, section")].filter((el) => {
        const s = cs(el); const r = el.getBoundingClientRect();
        if (r.width < 120 || r.height < 80 || r.width > vw * 0.9 || s.borderRadius === "0px") return false;
        const framed = s.boxShadow !== "none" || px(s.borderTopWidth) > 0 || !transparent(s.backgroundColor);
        return framed && !!el.querySelector("img, h2, h3, h4, h5, picture");
      }).slice(0, 400),
      "Navigation items": [...document.querySelectorAll("nav a, header a")],
      "Badges / tags / chips": [...document.querySelectorAll("span, small, div, a, li")].filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.height > 34 || r.width > 220 || !el.innerText || el.children.length > 1) return false;
        const s = cs(el); return !transparent(s.backgroundColor) && s.borderRadius !== "0px";
      }).slice(0, 300),
      "Images": [...document.querySelectorAll("img")].filter((el) => el.getBoundingClientRect().width > 60),
      "Tables": [...document.querySelectorAll("table")],
      "Dialogs / popups": [...document.querySelectorAll("dialog, [role=dialog], [aria-modal=true]")],
    };
    const out = [];
    for (const [kind, list] of Object.entries(kinds)) {
      const groups = new Map();
      for (const el of list) {
        const s = cs(el);
        if (kind !== "Dialogs / popups" && !visible(el, s)) continue;
        const sig = [s.display, px(s.fontSize), s.fontWeight, hex(s.color), hex(s.backgroundColor), s.backgroundImage.slice(0, 40), s.borderTopWidth, hex(s.borderTopColor), s.borderRadius, s.paddingTop, s.paddingLeft, s.boxShadow.slice(0, 40), s.textTransform].join("|");
        const g = groups.get(sig) || { n: 0, el, s, texts: new Set() };
        g.n++; if (g.texts.size < 4) { const t = textOf(el, 30); if (t) g.texts.add(t); }
        groups.set(sig, g);
      }
      if (!groups.size) continue;
      out.push(`### ${kind}`);
      const sorted = [...groups.values()].sort((a, b) => b.n - a.n).slice(0, kind === "Images" ? 3 : 5);
      sorted.forEach((g, i) => {
        const r = g.el.getBoundingClientRect();
        out.push(`**Variant ${i + 1}** — used ${g.n}× · e.g. \`${label(g.el)}\` · ${round(r.width)}×${round(r.height)}px${g.texts.size ? ` · text: ${[...g.texts].map((t) => `"${t}"`).join(", ")}` : ""}`);
        out.push(fence("css", `/* computed style */\n.${kind.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, "")}-${i + 1} {\n${cssBlock(g.el, g.s)}\n}`));
        const st = stateRules(g.el, rules);
        if (st.length) out.push("States (from the site's CSS):\n" + fence("css", st.join("\n")));
      });
    }
    return out.join("\n\n") || "_No components found._";
  }

  // ---------- assets ----------
  function assets(P) {
    const out = [];
    if (P.fontFaces.length) {
      out.push("### Font files (@font-face)");
      const seen = new Set();
      out.push("| Family | Weight | Style | Display | Source |\n|---|---|---|---|---|\n" + P.fontFaces.filter((f) => { const k = f.family + f.weight + f.style; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40)
        .map((f) => `| ${f.family} | ${f.weight} | ${f.style} | ${f.display || ""} | ${clip(f.src, 140)} |`).join("\n"));
    }
    const fontLinks = [...document.querySelectorAll('link[href*="fonts.googleapis"], link[href*="typekit"], link[href*="fonts.bunny"], link[href*="fontawesome"], link[href*="font-awesome"]')].map((l) => l.href);
    if (fontLinks.length) out.push("### Font services\n" + fontLinks.map((u) => `- ${u}`).join("\n"));

    const svgs = [...document.querySelectorAll("svg")].filter((s) => visible(s));
    const sizes = new Map(); svgs.forEach((s) => { const r = s.getBoundingClientRect(); count(sizes, `${round(r.width)}×${round(r.height)}`); });
    const iconFonts = new Set();
    for (const el of document.querySelectorAll("i, span")) { const f = cs(el).fontFamily; if (/icon|awesome|material|symbols|feather|bootstrap-icons/i.test(f)) iconFonts.add(f.split(",")[0]); if (iconFonts.size > 5) break; }
    out.push(`### Icons\n- Inline SVG: ${svgs.length}${sizes.size ? ` (most common sizes: ${top(sizes, 4).map(([k, n]) => `${k} ×${n}`).join(", ")})` : ""}\n- Icon fonts: ${iconFonts.size ? [...iconFonts].join(", ") : "none"}`);
    const iconSample = svgs.find((s) => s.getBoundingClientRect().width <= 32);
    if (iconSample) out.push("Example icon markup:\n" + fence("html", clip(iconSample.outerHTML, 900)));

    const logo = document.querySelector('header img, header svg, [class*="logo" i] img, [class*="logo" i] svg, a[aria-label*="home" i] svg, img[alt*="logo" i]');
    if (logo) { const r = logo.getBoundingClientRect(); out.push(`### Logo\n\`${label(logo)}\` ${round(r.width)}×${round(r.height)}px${logo.src ? ` — ${logo.src}` : ""}`); }

    const imgs = [...document.images].filter((i) => visible(i));
    if (imgs.length) {
      out.push(`### Images (${imgs.length} visible)\n| Shown size | File size | Alt | Source |\n|---|---|---|---|\n` + imgs.slice(0, 40).map((i) => {
        const r = i.getBoundingClientRect();
        return `| ${round(r.width)}×${round(r.height)} | ${i.naturalWidth}×${i.naturalHeight} | ${clip(i.alt, 40) || "⚠️ missing"} | ${clip(i.currentSrc || i.src, 110)} |`;
      }).join("\n"));
    }
    const bgs = new Set();
    for (const el of document.querySelectorAll("*")) { const b = cs(el).backgroundImage; if (b.startsWith("url(")) bgs.add(clip(b, 140)); if (bgs.size >= 25) break; }
    if (bgs.size) out.push("### Background images\n" + [...bgs].map((b) => `- ${b}`).join("\n"));
    const media = [...document.querySelectorAll("video, audio, iframe")].map((m) => `- ${m.localName}: ${clip(m.currentSrc || m.src, 120)}`);
    if (media.length) out.push("### Video / audio / embeds\n" + media.slice(0, 20).join("\n"));
    return out.join("\n\n");
  }

  // ---------- behaviour & content ----------
  function behaviour() {
    const out = [];
    const forms = [...document.forms];
    if (forms.length) {
      out.push(`### Forms (${forms.length})`);
      forms.slice(0, 10).forEach((f, i) => {
        const fields = [...f.elements].filter((e) => e.type !== "hidden" && e.localName !== "fieldset").map((e) => {
          const lab = (e.labels && e.labels[0] && e.labels[0].innerText) || e.placeholder || e.getAttribute("aria-label") || e.name || e.innerText;
          return `${e.localName}${e.type && e.localName === "input" ? `[${e.type}]` : ""} "${clip(lab, 40)}"${e.required ? " (required)" : ""}`;
        });
        out.push(`${i + 1}. \`${label(f)}\` method=${(f.method || "get").toUpperCase()} action=${clip(f.getAttribute("action") || "(same page)", 80)}\n   - ${fields.join("\n   - ") || "(no fields)"}`);
      });
    }
    const w = [];
    const n = (sel) => document.querySelectorAll(sel).length;
    const add = (name, sel) => { const c = n(sel); if (c) w.push(`- ${name}: ${c}`); };
    add("Expand/collapse toggles (aria-expanded)", "[aria-expanded]");
    add("Details/summary", "details");
    add("Tabs", "[role=tab]");
    add("Dialogs / modals", "dialog, [role=dialog], [aria-modal]");
    add("Carousels / sliders", '[class*="swiper" i], [class*="slick" i], [class*="carousel" i], [class*="slider" i], [aria-roledescription=carousel]');
    add("Tooltips", "[role=tooltip], [data-tooltip], [data-tippy-content]");
    add("Dropdown menus", '[role=menu], [aria-haspopup]');
    add("Accordions", '[class*="accordion" i]');
    add("Lazy-loaded images", 'img[loading=lazy], img[data-src]');
    if (w.length) out.push("### Interactive parts\n" + w.join("\n"));

    const scripts = new Map();
    for (const s of document.scripts) { if (!s.src) { count(scripts, "(inline)"); continue; } try { count(scripts, new URL(s.src).hostname); } catch {} }
    out.push("### Scripts by domain\n" + top(scripts, 20).map(([d, c]) => `- ${d}: ${c}`).join("\n"));
    return out.join("\n\n");
  }

  function content() {
    const out = [];
    const hs = [...document.querySelectorAll("h1, h2, h3, h4")].filter((h) => visible(h)).slice(0, 80);
    if (hs.length) out.push("### Heading outline\n" + hs.map((h) => `${"  ".repeat(+h.localName[1] - 1)}- ${h.localName.toUpperCase()}: ${clip(h.innerText, 90)}`).join("\n"));
    const navs = [...document.querySelectorAll("nav, [role=navigation]")].filter((x) => visible(x)).slice(0, 4);
    navs.forEach((nv, i) => {
      const links = [...nv.querySelectorAll("a")].filter((a) => a.innerText.trim()).slice(0, 25).map((a) => `[${clip(a.innerText, 30)}](${a.getAttribute("href") || ""})`);
      if (links.length) out.push(`### Navigation ${i + 1} (\`${label(nv)}\`)\n${links.join(" · ")}`);
    });
    const links = [...document.links];
    const internal = links.filter((a) => a.hostname === location.hostname).length;
    const issues = [];
    const noAlt = [...document.images].filter((i) => !i.hasAttribute("alt")).length;
    if (noAlt) issues.push(`${noAlt} image(s) without alt text`);
    const unnamed = [...document.querySelectorAll("button, a[href]")].filter((b) => !(b.innerText.trim() || b.getAttribute("aria-label") || b.getAttribute("title") || b.querySelector("img[alt]"))).length;
    if (unnamed) issues.push(`${unnamed} button(s)/link(s) without an accessible name`);
    if (document.querySelectorAll("h1").length !== 1) issues.push(`${document.querySelectorAll("h1").length} H1 headings (1 is recommended)`);
    if (!document.documentElement.lang) issues.push("no lang attribute on <html>");
    const landmarks = ["header", "nav", "main", "footer", "aside"].filter((t) => document.querySelector(t));
    out.push(`### Links & accessibility\n- Links: ${links.length} (${internal} internal, ${links.length - internal} external)\n- Landmarks present: ${landmarks.join(", ") || "none"}\n- Issues: ${issues.join("; ") || "none found"}`);
    return out.join("\n\n");
  }

  // ---------- HTML skeleton (appendix) ----------
  const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/;
  const KEEP_ATTR = /^(id|class|href|src|alt|role|type|name|placeholder|for|action|method|rel|target|title|viewBox|width|height|loading|lang|dir|style)$|^aria-/;
  function skeleton(limit = 250000) {
    let out = "", cut = false;
    const ser = (n, d) => {
      if (cut) return;
      if (out.length > limit) { cut = true; return; }
      if (n.nodeType === 3) { const t = n.textContent.replace(/\s+/g, " ").trim(); if (t) out += "  ".repeat(d) + clip(t, 100) + "\n"; return; }
      if (n.nodeType !== 1) return;
      const tag = n.localName;
      if (/^(script|style|noscript|template|link|meta)$/.test(tag)) return;
      const attrs = [...n.attributes].filter((a) => KEEP_ATTR.test(a.name)).map((a) => ` ${a.name}="${clip(a.value, a.name === "style" ? 160 : 120).replace(/"/g, "&quot;")}"`).join("");
      if (tag === "svg") { out += `${"  ".repeat(d)}<svg${attrs}>…</svg>\n`; return; }
      const kids = [...n.childNodes].filter((c) => c.nodeType === 1 || (c.nodeType === 3 && c.textContent.trim()));
      if (VOID.test(tag)) { out += `${"  ".repeat(d)}<${tag}${attrs}>\n`; return; } // <img>, <input>… have no closing tag
      if (!kids.length) { out += `${"  ".repeat(d)}<${tag}${attrs}></${tag}>\n`; return; }
      if (kids.length === 1 && kids[0].nodeType === 3) { out += `${"  ".repeat(d)}<${tag}${attrs}>${clip(kids[0].textContent, 100)}</${tag}>\n`; return; }
      out += `${"  ".repeat(d)}<${tag}${attrs}>\n`;
      for (const c of kids) ser(c, d + 1);
      out += `${"  ".repeat(d)}</${tag}>\n`;
    };
    ser(document.body, 0);
    return out + (cut ? "\n<!-- … cut here: the page is very large -->\n" : "");
  }

  // ---------- internal links (for analysing the whole site) ----------
  function siteLinks() {
    const here = location.origin + location.pathname;
    const score = new Map();
    for (const a of document.links) {
      let u; try { u = new URL(a.href); } catch { continue; }
      if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) continue;
      if (/\.(pdf|zip|rar|7z|jpe?g|png|gif|webp|svg|mp4|mp3|docx?|xlsx?|pptx?|exe|dmg)$/i.test(u.pathname)) continue;
      if (/log-?out|sign-?out|logoff|cart\/(add|remove)|delete|unsubscribe/i.test(u.pathname + u.search)) continue; // never click these
      const key = u.origin + u.pathname.replace(/\/$/, "");
      if (key === here.replace(/\/$/, "")) continue;
      let sc = 1;
      if (a.closest("nav, header, [role=navigation]")) sc += 4; // main menu pages first
      if (a.closest("main, article")) sc += 2;
      if (a.closest("footer")) sc += 1;
      score.set(key, (score.get(key) || 0) + sc);
    }
    return [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).map(([u]) => u);
  }

  // ---------- markdown report ----------
  function table(rows, head) { return rows.length ? `| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|\n` + rows.map((r) => `| ${r.join(" | ")} |`).join("\n") : "_none_"; }

  function run(fetched, tech, opts = {}) {
    if (opts.mode === "page") return runPage(fetched, opts);
    const t0 = performance.now();
    const P = parseSheets(fetched);
    const { els, total } = sweep();
    const T = tokens(els);
    const meta = (n) => (document.querySelector(`meta[name="${n}"], meta[property="${n}"]`) || {}).content || "";
    const md = [];

    md.push(`# Blueprint: ${document.title || location.hostname}`);
    md.push(`> **For Claude:** this file describes the complete front-end of ${location.href} — structure, design system, components with their CSS and states, motion, responsive rules, assets and behaviour, followed by the full CSS and an HTML skeleton. A full-page screenshot may be attached separately. Use it to reproduce this site's design and layout faithfully in another project.`);
    md.push(`## 1. Overview
| | |
|---|---|
| URL | ${location.href} |
| Captured | ${new Date().toISOString()} at viewport ${vw}×${vh}, page height ${document.documentElement.scrollHeight}px |
| Language / direction | ${document.documentElement.lang || "?"} / ${cs(document.documentElement).direction} |
| Description | ${clip(meta("description") || meta("og:description"), 200)} |
| Theme color | ${meta("theme-color")} |
| Technologies detected | ${tech && tech.length ? tech.join(", ") : "none recognised (plain HTML/CSS or custom)"} |
| Size | ${total} elements (${els.length} visible analysed), ${P.sheetCount} stylesheets, ${P.ruleCount} CSS rules |`);

    md.push(`## 2. Page structure (top to bottom)
Each line: element — size and position · layout · contents. Indentation = nesting.

${structure()}`);

    const colorRows = (map, tot, n) => top(map, n).map(([c, v]) => [`\`${c}\``, tot ? pct(v, tot) + "%" : v + "×"]);
    md.push(`## 3. Design system
### Colors
**Backgrounds** (by area)
${table(colorRows(T.bg, T.bgTotal, 12), ["Color", "Share"])}

**Text** (by amount of text)
${table(colorRows(T.text, T.textTotal, 10), ["Color", "Share"])}

**Borders**
${table(colorRows(T.border, 0, 8), ["Color", "Uses"])}
${T.gradients.size ? "\n**Gradients**\n" + top(T.gradients, 8).map(([g, n]) => `- \`${g}\` ×${n}`).join("\n") : ""}

### Typography
**Font families** (by amount of text)
${top(T.families, 6).map(([f, n]) => `- \`${f}\` — ${pct(n, T.textTotal)}%`).join("\n")}

**Font sizes used:** ${top(T.sizes, 14).sort((a, b) => b[0] - a[0]).map(([s, n]) => `${s}px (${pct(n, T.textTotal)}%)`).join(", ")}
**Weights:** ${top(T.weights, 6).map(([w, n]) => `${w} (${pct(n, T.textTotal)}%)`).join(", ")}
**Line heights (× font size):** ${top(T.lineHeights, 6).map(([l]) => l).join(", ")}

**Text styles per element**
${typography(els)}

### Spacing, shapes and depth
- **Spacing values** (padding/margin/gap, most used first): ${top(T.spacing, 16).map(([v, n]) => `${v}px ×${n}`).join(", ")}
- **Likely base unit:** ${(() => { const vals = top(T.spacing, 30); const tot = vals.reduce((s, [, n]) => s + n, 0); const by = (u) => vals.filter(([v]) => v % u === 0).reduce((s, [, n]) => s + n, 0); return by(8) / tot > 0.6 ? "8px" : by(4) / tot > 0.6 ? "4px" : "none clear"; })()}
- **Content widths (max-width of centered containers):** ${top(T.widths, 5).map(([w, n]) => `${w} ×${n}`).join(", ") || "none"}
- **Border radius:** ${top(T.radii, 10).map(([r, n]) => `${r} ×${n}`).join(", ") || "none"}
- **Borders:** ${top(T.borders, 6).map(([b, n]) => `${b} ×${n}`).join(", ") || "none"}
- **Shadows:**
${top(T.shadows, 8).map(([s, n]) => `  - \`${s}\` ×${n}`).join("\n") || "  - none"}
- **z-index values:** ${top(T.zs, 10).map(([z]) => z).join(", ") || "none"}

### CSS variables (design tokens defined by the site)
${P.rootVars.size ? fence("css", ":root {\n" + [...P.rootVars].slice(0, 300).map(([k, v]) => `  ${k}: ${clip(v, 160)};`).join("\n") + "\n}") + (P.rootVars.size > 300 ? `\n(${P.rootVars.size - 300} more in the full CSS below)` : "") : "_The site defines no CSS variables on :root._"}`);

    md.push(`## 4. Components
Grouped by identical look; the most used variants first. "States" are the site's own :hover/:focus/:active/:disabled rules that apply to that element.

${components(P.rules)}`);

    md.push(`## 5. Motion and effects
- **Transitions in use:** ${top(T.transitions, 10).map(([t, n]) => `\`${clip(t, 90)}\` ×${n}`).join(", ") || "none"}
- **Animations running:** ${top(T.animations, 8).map(([a, n]) => `\`${a}\` ×${n}`).join(", ") || "none"}
- **Sticky / fixed elements:** ${els.filter(({ s }) => /sticky|fixed/.test(s.position)).slice(0, 10).map(({ el, s }) => `\`${label(el)}\` (${s.position})`).join(", ") || "none"}
- **Smooth scrolling:** ${cs(document.documentElement).scrollBehavior}
${P.keyframes.length ? "\n**@keyframes**\n" + fence("css", P.keyframes.slice(0, 25).map((k) => clip(k.css, 1500)).join("\n\n")) : ""}`);

    const bps = new Set();
    for (const c of P.media.keys()) for (const m of c.matchAll(/(min|max)-width:\s*([\d.]+)(px|em|rem)/g)) bps.add(`${m[1]} ${m[2]}${m[3]}`);
    md.push(`## 6. Responsive design
- **Breakpoints (width):** ${[...bps].sort((a, b) => parseFloat(a.split(" ")[1]) - parseFloat(b.split(" ")[1])).join(", ") || "none found"}
${P.containers.size ? `- **Container queries:** ${[...P.containers].slice(0, 10).join(", ")}\n` : ""}${P.layers.size ? `- **Cascade layers:** ${[...P.layers].join(", ")}\n` : ""}
${table([...P.media.entries()].sort((a, b) => b[1].rules - a[1].rules).slice(0, 30).map(([c, m]) => [`\`${clip(c, 70)}\``, m.rules, [...m.sample].map((s) => `\`${s}\``).join(", ")]), ["Media query", "Rules", "Examples of what changes"])}`);

    md.push(`## 7. Assets\n${assets(P)}`);
    md.push(`## 8. Behaviour\n${behaviour()}`);
    md.push(`## 9. Content and accessibility\n${content()}`);

    if (opts.css !== false) {
      let size = 0; const LIMIT = 900000; const parts = [];
      for (const s of P.fullCss) {
        if (!s.text.trim()) continue;
        if (size > LIMIT) { parts.push(`/* … ${s.href}: skipped – the CSS is very large */`); continue; }
        parts.push(`/* ===== ${s.href} ===== */\n${s.text}`); size += s.text.length;
      }
      md.push(`## Appendix A — Full CSS (${P.fullCss.length} stylesheets)\n${fence("css", parts.join("\n\n"))}`);
    }
    if (opts.html !== false) md.push(`## Appendix B — HTML skeleton\nScripts removed, long texts shortened, SVG contents hidden.\n${fence("html", skeleton())}`);

    return { md: md.join("\n\n") + "\n", stats: { ms: round(performance.now() - t0), elements: els.length, rules: P.ruleCount, sheets: P.sheetCount }, links: siteLinks(), sheets: P.fullCss.map((c) => (c.href === "(inline <style>)" ? "inline:" + c.text.length + ":" + c.text.slice(0, 200) : c.href)), height: document.documentElement.scrollHeight };
  }

  // another page of the same site: the design system is already known from the
  // first page, so only what is specific to this page is exported
  function runPage(fetched, opts) {
    const t0 = performance.now();
    const P = parseSheets(fetched);
    const { els } = sweep();
    const known = new Set(opts.knownSheets || []);
    const md = [];
    md.push(`### Structure\n${structure()}`);
    md.push(`### Components on this page\n${components(P.rules).replace(/^### /gm, "#### ")}`);
    md.push(`### Assets\n${assets(P).replace(/^### /gm, "#### ")}`);
    md.push(`### Behaviour\n${behaviour().replace(/^### /gm, "#### ")}`);
    md.push(`### Content\n${content().replace(/^### /gm, "#### ")}`);
    const fresh = P.fullCss.filter((c) => c.text.trim() && !known.has(c.href) && c.href !== "(inline <style>)");
    // inline <style> blocks repeated on every page are exported once
    const inline = P.fullCss.filter((c) => c.href === "(inline <style>)" && c.text.trim() && !known.has("inline:" + c.text.length + ":" + c.text.slice(0, 200)));
    if (opts.css !== false && (fresh.length || inline.length)) {
      md.push(`### CSS used only on this page\n${fence("css", [...fresh, ...inline].map((c) => `/* ===== ${c.href} ===== */\n${c.text.slice(0, 300000)}`).join("\n\n"))}`);
    }
    if (opts.html !== false) md.push(`### HTML skeleton\n${fence("html", skeleton(150000))}`);
    return { md: md.join("\n\n") + "\n", stats: { ms: round(performance.now() - t0), elements: els.length, rules: P.ruleCount, sheets: P.sheetCount }, links: siteLinks(), sheets: P.fullCss.map((c) => (c.href === "(inline <style>)" ? "inline:" + c.text.length + ":" + c.text.slice(0, 200) : c.href)), height: document.documentElement.scrollHeight };
  }

  window.__bp = { sheetsToFetch, run };
})();
