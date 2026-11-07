// Night – decides on/off for this site, then CSS (dark.css) does the work.
(() => {
  const html = document.documentElement;
  const host = location.hostname.replace(/^www\./, "");
  const DEF = { on: true, sites: {}, brightness: 100, contrast: 100, sepia: 0, skipDark: true };
  let s = DEF;

  function luminance(color) {
    const m = color.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
    if (!m || (m[4] !== undefined && +m[4] < 0.1)) return null; // transparent
    const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // is the site already dark? (background of body or html is dark)
  function siteIsDark() {
    for (const el of [document.body, html]) {
      if (!el) continue;
      const l = luminance(getComputedStyle(el).backgroundColor);
      if (l !== null) return l < 0.2;
    }
    return false;
  }

  function apply() {
    const pref = s.sites[host]; // "on" | "off" | undefined
    let on = pref ? pref === "on" : s.on;
    if (on && !pref && s.skipDark && document.body) {
      html.removeAttribute("data-night"); // measure the site's own colors, not ours
      if (siteIsDark()) on = false;
    }
    if (on) {
      html.setAttribute("data-night", "");
      html.style.setProperty("--night-b", s.brightness / 100);
      html.style.setProperty("--night-c", s.contrast / 100);
      html.style.setProperty("--night-s", s.sepia / 100);
    } else {
      html.removeAttribute("data-night");
    }
  }

  chrome.storage.sync.get(DEF).then((v) => {
    s = v;
    apply(); // early: no white flash
    // once the page has its colors, check again whether it was dark already
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply, { once: true });
    else apply();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "sync") return;
    for (const k in c) s[k] = c[k].newValue;
    apply();
  });
})();
