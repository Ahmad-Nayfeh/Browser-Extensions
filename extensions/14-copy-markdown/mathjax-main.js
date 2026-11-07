// Runs in the page's own world for a moment: MathJax keeps the original TeX
// only in its JavaScript objects, so we copy it onto the formula elements.
(() => {
  try {
    const MJ = window.MathJax;
    if (MJ && MJ.startup && MJ.startup.document && MJ.startup.document.math) {
      for (const item of MJ.startup.document.math) {            // MathJax 3
        if (!item.inputJax || item.inputJax.name !== "TeX") continue; // MathML/AsciiMath input isn't TeX
        const n = item.typesetRoot;
        if (n && n.setAttribute) { n.setAttribute("data-md-tex", item.math); n.setAttribute("data-md-display", item.display ? "1" : "0"); }
      }
    } else if (MJ && MJ.Hub && MJ.Hub.getAllJax) {               // MathJax 2
      for (const jax of MJ.Hub.getAllJax()) {
        if (jax.inputJax !== "TeX") continue;
        const src = jax.SourceElement();
        const frame = document.getElementById(jax.inputID + "-Frame");
        const target = frame && (frame.closest(".MathJax_Display") || frame);
        if (!target) continue;
        const wrapper = document.createElement("span");
        target.before(wrapper);
        wrapper.setAttribute("data-md-tex", jax.originalText);
        wrapper.setAttribute("data-md-display", /mode=display/.test(src.type) ? "1" : "0");
        src.setAttribute("data-md-skip", "");
      }
    }
  } catch {}
})();
