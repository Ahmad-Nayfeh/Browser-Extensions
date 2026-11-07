// Copy as Markdown – HTML → Markdown converter.
// Injected into a page only when you use the extension; defines
// window.__copyMarkdown({ mode: "selection" | "page", header: bool }).
(() => {
  if (window.__copyMarkdown) return;

  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "IFRAME", "CANVAS", "VIDEO", "AUDIO", "OBJECT", "EMBED"]);
  const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE", "NAV", "FIGURE", "DL", "DT", "DD", "ADDRESS", "DETAILS", "SUMMARY", "FORM", "FIELDSET"]);
  // removed when converting a whole page (menus, ads, comments…)
  const PAGE_JUNK = "nav, aside, footer, header:not(article header), form, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true], .mw-editsection, sup.reference, .reference, .navbox, .sidebar, .advert, .ad, .ads, .share, .social, .comments, #comments";

  const abs = (u) => { try { return new URL(u, document.baseURI).href; } catch { return u || ""; } };
  const esc = (s) => s.replace(/([\\`*_\[\]])/g, "\\$1");
  const wrap = (inner, mark) => {
    const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
  };

  // ---------- math ----------
  function cleanTex(t) {
    t = t.trim();
    const m = t.match(/^\{\\(?:displaystyle|textstyle)\s*([\s\S]*)\}$/);
    return (m ? m[1] : t).trim();
  }
  // Wikipedia keeps the TeX in a JSON attribute: data-mw='{"body":{"extsrc":"..."}}'
  function wikiTex(el) {
    const holder = el.hasAttribute("data-mw") ? el : el.querySelector && el.querySelector("[data-mw]");
    if (!holder) return null;
    try { const d = JSON.parse(holder.getAttribute("data-mw")); return d.name === "math" && d.body ? d.body.extsrc : null; } catch { return null; }
  }
  // returns { tex, display } if el is the root of a formula
  function mathOf(el) {
    if (el.hasAttribute && el.hasAttribute("data-md-tex")) {
      return { tex: el.getAttribute("data-md-tex"), display: el.getAttribute("data-md-display") === "1" };
    }
    const cls = el.classList;
    if (cls && (cls.contains("katex") || cls.contains("mwe-math-element"))) {
      const ann = el.querySelector('annotation[encoding="application/x-tex"]');
      const math = el.querySelector("math");
      const tex = ann ? ann.textContent : (math && math.getAttribute("alttext")) || wikiTex(el);
      if (tex) {
        const display = !!el.closest(".katex-display") || cls.contains("mwe-math-element-block") ||
          (math && math.getAttribute("display") === "block");
        return { tex, display };
      }
    }
    if (el.localName === "math") {
      const ann = el.querySelector('annotation[encoding="application/x-tex"]');
      const tex = ann ? ann.textContent : el.getAttribute("alttext") || wikiTex(el);
      if (tex) return { tex, display: el.getAttribute("display") === "block" };
    }
    if (el.localName === "script" && /^math\/tex/.test(el.type)) {
      return { tex: el.textContent, display: /mode=display/.test(el.type) };
    }
    return null;
  }

  // ---------- converter ----------
  function children(node, ctx) {
    let out = "";
    for (const c of node.childNodes) out += conv(c, ctx);
    return out;
  }

  function block(s) { s = s.trim(); return s ? `\n\n${s}\n\n` : ""; }

  function list(el, ctx) {
    const ordered = el.tagName === "OL";
    let n = +(el.getAttribute("start") || 1);
    let out = "";
    for (const li of el.children) {
      if (li.tagName !== "LI") continue;
      const marker = ordered ? `${n++}. ` : "- ";
      const pad = " ".repeat(marker.length);
      const body = children(li, ctx).replace(/\n{3,}/g, "\n\n").trim()
        .replace(/\n\n+(?=\s*(?:- |\d+\. ))/g, "\n"); // keep nested lists tight
      const lines = body.split("\n");
      out += marker + lines[0] + "\n" + lines.slice(1).map((l) => (l ? pad + l : l)).join("\n") + (lines.length > 1 ? "\n" : "");
    }
    return `\n\n${out.trimEnd()}\n\n`;
  }

  function table(el, ctx) {
    const rows = [...el.querySelectorAll("tr")].filter((tr) => tr.closest("table") === el);
    if (!rows.length) return "";
    const cells = rows.map((tr) => [...tr.children].filter((c) => /^T[HD]$/.test(c.tagName))
      .map((c) => conv(c, { ...ctx, inTable: true }).replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim()));
    const width = Math.max(...cells.map((r) => r.length));
    if (!width) return "";
    const line = (r) => "| " + Array.from({ length: width }, (_, i) => r[i] || "").join(" | ") + " |";
    const out = [line(cells[0]), "| " + Array(width).fill("---").join(" | ") + " |", ...cells.slice(1).map(line)];
    const cap = el.querySelector("caption");
    return `\n\n${cap ? `*${cap.textContent.trim()}*\n\n` : ""}${out.join("\n")}\n\n`;
  }

  function conv(node, ctx) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (ctx.pre) return node.textContent;
      return esc(node.textContent.replace(/\s+/g, " "));
    }
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return children(node, ctx);
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node;

    const m = mathOf(el);
    if (m) {
      const tex = cleanTex(m.tex);
      return m.display && !ctx.inTable ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
    }
    if (SKIP.has(el.tagName)) return "";
    if (el.hasAttribute("data-md-skip")) return "";
    // MathJax 2 draws formulas in these; the TeX comes from its <script> instead
    if (/\bMathJax(_Preview|_Display|_SVG|_CHTML)?\b/.test(el.className)) return "";
    // hidden elements are skipped – except the hidden source of a formula (Wikipedia hides
    // the MathML that holds the TeX and shows a drawn copy instead)
    if ((el.hidden || (el.style && el.style.display === "none")) && !el.querySelector("math, [data-mw], annotation")) return "";
    // a formula drawn by MathJax without its TeX: the source is elsewhere on the page
    if (el.localName === "mjx-container") return "";

    const tag = el.tagName;
    switch (tag) {
      case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": {
        const t = children(el, ctx).replace(/\s+/g, " ").trim();
        return t ? `\n\n${"#".repeat(+tag[1])} ${t}\n\n` : "";
      }
      case "BR": return ctx.inTable ? " " : "\\\n";
      case "HR": return "\n\n---\n\n";
      case "STRONG": case "B": return wrap(children(el, ctx), "**");
      case "EM": case "I": case "CITE": return wrap(children(el, ctx), "*");
      case "DEL": case "S": case "STRIKE": return wrap(children(el, ctx), "~~");
      case "SUB": return `<sub>${children(el, ctx)}</sub>`;
      case "SUP": return `<sup>${children(el, ctx)}</sup>`;
      case "CODE": case "KBD": case "SAMP": case "TT": {
        if (ctx.pre) return el.textContent;
        const t = el.textContent;
        const fence = t.includes("`") ? "``" : "`";
        return t.trim() ? `${fence}${t}${fence}` : "";
      }
      case "PRE": {
        const code = el.querySelector("code") || el;
        const langCls = [...code.classList, ...el.classList, ...(el.parentElement ? el.parentElement.classList : [])]
          .map((c) => (c.match(/^(?:language|lang|highlight-source|brush:?)-?(\w+)/) || [])[1]).find(Boolean);
        const text = el.textContent.replace(/\n+$/, "");
        const fence = text.includes("```") ? "~~~~" : "```";
        return `\n\n${fence}${langCls || ""}\n${text}\n${fence}\n\n`;
      }
      case "A": {
        const text = children(el, ctx).trim();
        const href = el.getAttribute("href");
        if (!href || href.startsWith("javascript:")) return text;
        if (href.startsWith("#") && ctx.mode === "page") return text; // in-page jump links
        const url = abs(href);
        if (!text) return "";
        if (text === url || text === esc(url)) return `<${url}>`;
        return `[${text}](${url.replace(/\)/g, "%29").replace(/ /g, "%20")})`;
      }
      case "IMG": {
        const src = el.currentSrc || el.getAttribute("src");
        if (!src || src.startsWith("data:")) return "";
        const alt = (el.getAttribute("alt") || "").replace(/[\[\]]/g, "");
        return `![${alt}](${abs(src)})`;
      }
      case "UL": case "OL": return list(el, ctx);
      case "LI": return block(children(el, ctx)); // a stray <li> (e.g. a selection inside a list)
      case "BLOCKQUOTE": {
        const t = children(el, ctx).replace(/\n{3,}/g, "\n\n").trim();
        return t ? "\n\n" + t.split("\n").map((l) => (l ? "> " + l : ">")).join("\n") + "\n\n" : "";
      }
      case "TABLE": return ctx.inTable ? children(el, ctx) : table(el, ctx);
      case "FIGCAPTION": { const t = children(el, ctx).trim(); return t ? `\n\n*${t}*\n\n` : ""; }
      case "TD": case "TH": return children(el, ctx);
    }
    const inner = children(el, ctx);
    return BLOCK.has(tag) && !ctx.inTable ? block(inner) : inner;
  }

  function tidy(md) {
    // squeeze double spaces in normal text (not inside code blocks or indentation)
    let fenced = false;
    md = md.split("\n").map((line) => {
      if (/^(```|~~~~)/.test(line.trim())) { fenced = !fenced; return line; }
      return fenced ? line : line.replace(/(\S) {2,}/g, "$1 ");
    }).join("\n");
    return md
      .replace(/\n\n (?=\S)/g, "\n\n")          // a lone space starting a paragraph
      .replace(/[ \t]+\n/g, "\n")        // spaces at line ends
      .replace(/\\\n[ \t]+/g, "\\\n")       // space after a line break
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n";
  }

  // ---------- what to convert ----------
  function mainContent() {
    const candidates = [...document.querySelectorAll("article, main, [role=main], #content, .post, .entry-content, .article-body")];
    const best = candidates.sort((a, b) => b.innerText.length - a.innerText.length)[0];
    const clone = (best || document.body).cloneNode(true);
    clone.querySelectorAll(PAGE_JUNK).forEach((e) => { if (!mathOf(e)) e.remove(); });
    return clone;
  }

  window.__copyMarkdown = ({ mode = "auto", header = true } = {}) => {
    const sel = getSelection();
    const hasSel = sel && sel.rangeCount && !sel.isCollapsed && sel.toString().trim();
    if (mode === "auto") mode = hasSel ? "selection" : "page";
    let root;
    if (mode === "selection" && hasSel) {
      root = document.createDocumentFragment();
      for (let i = 0; i < sel.rangeCount; i++) {
        const r = sel.getRangeAt(i);
        // selecting inside one formula/code block: keep the whole element
        const anc = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
        const whole = anc && anc.closest("[data-md-tex], .katex, .mwe-math-element, pre, table");
        root.append(whole ? whole.cloneNode(true) : r.cloneContents());
      }
    } else {
      mode = "page";
      root = mainContent();
    }
    let md = tidy(conv(root, { mode }));
    if (header) {
      const title = md.startsWith("# ") ? "" : `# ${document.title}\n\n`; // the article may have its own title
      md = `${title}Source: <${location.href}>\n\n${mode === "page" ? "" : "---\n\n"}` + md;
    }
    return { md, mode, title: document.title };
  };
})();
