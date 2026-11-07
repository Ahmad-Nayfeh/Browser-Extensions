const { launch, site, html, prepare, sleep } = require("./lib");

const DOC = html("Test Doc", `<nav>MENU</nav><article>
<h1>Main title</h1><p>Some <b> bold </b> and <i>italic</i> with a <a href="/rel/page">link</a> and <code>x = 1</code>.<br>New line.</p>
<ul><li>One</li><li>Two<ul><li>Two-A</li></ul></li></ul><ol><li>First</li><li>Second</li></ol>
<table><tr><th>Rating</th><th>Value</th></tr><tr><td>Voltage</td><td>11 kV</td></tr><tr><td>Current | max</td><td>630 A</td></tr></table>
<pre><code class="language-python">def f(x):
    return x * 2</code></pre>
<blockquote><p>Quoted</p></blockquote>
<p>KaTeX: <span class="katex"><span class="katex-mathml"><math><annotation encoding="application/x-tex">E = mc^2</annotation></math></span><span class="katex-html" aria-hidden="true">E=mc2</span></span>.</p>
<p>Wikipedia: <span class="mwe-math-mathml-a11y" style="display:none"><math class="mwe-math-element mwe-math-element-inline" data-mw='{"name":"math","attrs":{},"body":{"extsrc":"P = VI"}}'><mi>P</mi></math></span><mjx-container>drawn</mjx-container></p>
<math class="mwe-math-element mwe-math-element-block" display="block" data-mw='{"name":"math","attrs":{"display":"block"},"body":{"extsrc":"\\\\int_0^1 x\\\\,dx"}}'><mi>x</mi></math>
</article><footer>FOOTER</footer>`);

module.exports = [
  {
    name: "converts a page to clean Markdown (lists, table, code, LaTeX incl. Wikipedia) and copies it",
    async run(t) {
      const b = await launch([{ name: "14-copy-markdown", dir: prepare("14-copy-markdown", { hosts: ["<all_urls>"], permissions: ["tabs"] }) }]);
      try {
        await site(b.ctx, { "doc.test/*": DOC });
        await b.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://doc.test" });
        const w = b.workers["14-copy-markdown"];
        const p = await b.ctx.newPage();
        await p.goto("https://doc.test/a/b");
        const tab = await b.tabOf(w, "doc.test");
        const { md } = await w.evaluate((id) => convert(id, "page"), tab.id);
        t.log(md);
        t.includes(md, "# Main title", "heading");
        t.includes(md, "Some **bold** and *italic* with a [link](https://doc.test/rel/page) and `x = 1`.\\\nNew line.", "inline formatting, absolute link, line break");
        t.includes(md, "- Two\n  - Two-A", "nested list stays tight");
        t.includes(md, "1. First\n2. Second", "numbered list");
        t.includes(md, "| Rating | Value |\n| --- | --- |\n| Voltage | 11 kV |\n| Current \\| max | 630 A |", "table with escaped pipe");
        t.includes(md, "```python\ndef f(x):\n    return x * 2\n```", "code block with language and indentation");
        t.includes(md, "> Quoted", "quote");
        t.includes(md, "$E = mc^2$", "KaTeX formula as LaTeX");
        t.includes(md, "Wikipedia: $P = VI$", "Wikipedia formula (hidden source) as LaTeX, drawn copy skipped");
        t.includes(md, "$$\n\\int_0^1 x\\,dx\n$$", "display formula as a $$ block");
        t.ok(!md.includes("MENU") && !md.includes("FOOTER"), "menus and footer left out of the article");
        await p.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector("table")); getSelection().removeAllRanges(); getSelection().addRange(r); });
        const sel = await w.evaluate((id) => convert(id, "auto"), tab.id);
        t.equal(sel.mode, "selection", "a selection is converted instead of the page");
        t.includes(sel.md, "| Rating | Value |", "selected table converted");
        await w.evaluate((id) => run(id, "page"), tab.id);
        await sleep(500);
        t.includes(await p.evaluate(() => navigator.clipboard.readText()), "# Main title", "right-click / shortcut copies to the clipboard");
      } finally { await b.close(); }
    },
  },
];
