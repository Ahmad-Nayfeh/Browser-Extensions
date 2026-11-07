// Trace – turns the recorded events into one Markdown report.
const $ = (id) => document.getElementById(id);
const clip = (s, n = 120) => { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const code = (s) => "`" + String(s).replace(/`/g, "'") + "`";

function shortUrl(u, base) {
  try { const x = new URL(u); return x.origin === base ? x.pathname + x.search : x.href; } catch { return u; }
}
const fmtT = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const what = (d) => (d ? `${d.tag}${d.inputType ? `[${d.inputType}]` : ""}${d.text ? ` "${clip(d.text, 60)}"` : ""} (${code(d.sel)})${d.disabled ? " ⚠️ disabled" : ""}` : "?");

function build(events) {
  const startEv = events.find((e) => e.type === "start") || events[0];
  const t0 = startEv ? startEv.t : Date.now();
  const end = (events.find((e) => e.type === "stop") || events[events.length - 1] || {}).t || t0;
  let origin = ""; try { origin = new URL(startEv.url).origin; } catch {}

  const errors = events.filter((e) => e.type === "js-error");
  const consoleErr = events.filter((e) => e.type === "console" && e.level === "error");
  const consoleWarn = events.filter((e) => e.type === "console" && e.level === "warn");
  const requests = events.filter((e) => e.type === "request");
  const failed = requests.filter((e) => e.status === 0 || e.status >= 400);
  const slow = requests.filter((e) => e.ms > 3000);
  const resErr = events.filter((e) => e.type === "resource-error");
  const shownErrors = events.filter((e) => e.type === "dom" && e.appeared && e.appeared.some((a) => a.error));
  const actions = events.filter((e) => ["click", "dblclick", "input", "submit", "key"].includes(e.type));
  const pages = events.filter((e) => e.type === "page");

  // step numbers: each user action / navigation starts a new step
  let step = 0;
  const stepOf = new Map();
  for (const e of events) {
    if (["click", "dblclick", "input", "submit", "key", "nav", "route"].includes(e.type)) step++;
    stepOf.set(e, step || 1);
  }

  const md = [];
  md.push(`# Test session report – ${origin || "website"}`);
  md.push(`> **For Claude:** I tested my website by hand while this recorder was running. Below is everything that happened, in order: what I did (clicks, typing, navigation), what the page did in response (requests to the server, changes on screen, messages shown) and every error. Please (1) list the bugs and problems you find, (2) explain the most likely cause of each, using the step numbers, and (3) tell me what to change in my source code (I'll share the relevant files if needed). Passwords and other secret fields were hidden by the recorder.`);

  md.push(`## Summary
| | |
|---|---|
| Site | ${startEv.url} |
| Recorded | ${new Date(t0).toLocaleString()} – duration ${fmtT(end - t0)} |
| Browser | ${clip(startEv.ua, 160)} |
| Your actions | ${actions.length} (${events.filter((e) => e.type === "click").length} clicks, ${events.filter((e) => e.type === "input").length} inputs, ${events.filter((e) => e.type === "submit").length} form submits) |
| Pages / screens visited | ${new Set(events.filter((e) => ["start", "nav", "route"].includes(e.type)).map((e) => e.url)).size} |
| JavaScript errors | ${errors.length} |
| Console errors / warnings | ${consoleErr.length} / ${consoleWarn.length} |
| Server requests (fetch/XHR) | ${requests.length} – **${failed.length} failed**, ${slow.length} slow (> 3 s) |
| Files that failed to load | ${resErr.length} |
| Error messages shown on screen | ${shownErrors.length} |`);

  // ---- problems first ----
  const problems = [];
  const group = (list, key, fmt) => {
    const m = new Map();
    for (const e of list) { const k = key(e); const g = m.get(k) || { e, n: 0, steps: new Set() }; g.n++; g.steps.add(stepOf.get(e)); m.set(k, g); }
    for (const g of m.values()) problems.push(fmt(g.e, g.n, [...g.steps].slice(0, 8).join(", ")));
  };
  group(errors, (e) => e.text, (e, n, s) => `- ❌ **JavaScript error** (step ${s}${n > 1 ? `, ${n}×` : ""}): ${code(clip(e.text, 300))}${e.source ? ` at ${shortUrl(e.source, origin)}:${e.line}:${e.col}` : ""}${e.stack ? "\n  ```\n  " + clip(e.stack, 900).replace(/ at /g, "\n    at ") + "\n  ```" : ""}`);
  group(failed, (e) => `${e.method} ${e.url.split("?")[0]} ${e.status}`, (e, n, s) => `- ❌ **Request failed** (step ${s}${n > 1 ? `, ${n}×` : ""}): ${e.method} ${code(shortUrl(e.url, origin))} → **${e.status || "no response"}**${e.error ? ` (${e.error})` : ""}${e.body ? `\n  Server answered: ${code(clip(e.body, 500))}` : ""}`);
  group(consoleErr, (e) => e.text, (e, n, s) => `- ⚠️ **console.error** (step ${s}${n > 1 ? `, ${n}×` : ""}): ${code(clip(e.text, 400))}`);
  group(resErr, (e) => e.url, (e, n, s) => `- ⚠️ **File failed to load** (step ${s}): ${e.tag} ${code(shortUrl(e.url, origin))}${e.status ? ` → ${e.status}` : ""}`);
  group(shownErrors, (e) => e.appeared.filter((a) => a.error).map((a) => a.text).join("|"), (e, n, s) => `- ⚠️ **Error message shown on screen** (step ${s}): ${e.appeared.filter((a) => a.error).map((a) => `"${clip(a.text, 200)}"`).join(", ")}`);
  group(slow, (e) => `${e.method} ${e.url.split("?")[0]}`, (e, n, s) => `- 🐢 **Slow request** (step ${s}): ${e.method} ${code(shortUrl(e.url, origin))} took ${(e.ms / 1000).toFixed(1)} s`);
  group(events.filter((e) => (e.type === "click") && e.target && e.target.disabled), (e) => e.target.sel, (e, n, s) => `- ℹ️ **Clicked a disabled element** (step ${s}${n > 1 ? `, ${n}×` : ""}): ${what(e.target)}`);
  md.push(`## Problems found\n${problems.join("\n") || "No errors were detected. (Visual or logic problems you noticed yourself are not visible to the recorder – add them to your message to Claude.)"}`);

  // ---- timeline ----
  const lines = [];
  let last = 0;
  for (const e of events) {
    const at = `[${fmtT(e.t - t0)}]`;
    const n = stepOf.get(e);
    const head = n !== last && ["click", "dblclick", "input", "submit", "key", "nav", "route"].includes(e.type);
    if (head) last = n;
    const pre = head ? `${n}. ${at} ` : `   ${at} ↳ `;
    switch (e.type) {
      case "start": lines.push(`0. ${at} **Recording started** on ${e.url} ("${clip(e.title, 80)}")`); break;
      case "nav": lines.push(`${pre}**Opened page** ${code(shortUrl(e.url, origin))}${e.how && e.how !== "link" ? ` (${e.how})` : ""}`); break;
      case "route": lines.push(`${pre}**Screen changed** (same page) → ${code(shortUrl(e.url, origin))}`); break;
      case "click": case "dblclick": lines.push(`${pre}${e.type === "click" ? "Click" : "Double-click"} ${what(e.target)}${e.target && e.target.href ? ` → ${code(shortUrl(e.target.href, origin))}` : ""}`); break;
      case "input": lines.push(`${pre}Entered in ${e.field.tag}${e.field.inputType ? `[${e.field.inputType}]` : ""} "${e.field.label || e.field.sel}": ${code(e.value)}`); break;
      case "submit": lines.push(`${pre}**Submitted form** ${code(e.form.sel)} (${e.form.method} ${code(shortUrl(e.form.action, origin))})`); break;
      case "key": lines.push(`${pre}Pressed **${e.key}** in ${what(e.target)}`); break;
      case "scroll": lines.push(`   ${at} ↳ scrolled to ${e.percent}% of the page`); break;
      case "resize": lines.push(`   ${at} ↳ window resized to ${e.w}×${e.h}`); break;
      case "request": {
        const bad = e.status === 0 || e.status >= 400;
        lines.push(`   ${at} ↳ ${bad ? "❌ " : ""}${e.method} ${code(shortUrl(e.url, origin))} → ${e.status || "failed"} (${e.ms} ms)${e.body ? ` — ${code(clip(e.body, 200))}` : ""}`);
        break;
      }
      case "dom": {
        const bits = [];
        if (e.added || e.removed) bits.push(`+${e.added} / −${e.removed} elements`);
        if (e.appeared && e.appeared.length) bits.push("appeared: " + e.appeared.map((a) => `${a.error ? "⚠️ " : ""}"${clip(a.text, 120)}"`).join(", "));
        lines.push(`   ${at} ↳ ${e.background ? "Page changed by itself" : "Page changed"}: ${bits.join("; ")}`);
        break;
      }
      case "js-error": lines.push(`   ${at} ↳ ❌ **JS error:** ${code(clip(e.text, 200))}`); break;
      case "console": if (e.level === "error" || e.level === "warn") lines.push(`   ${at} ↳ ${e.level === "error" ? "❌" : "⚠️"} console.${e.level}: ${code(clip(e.text, 200))}`); else lines.push(`   ${at} ↳ console.${e.level}: ${code(clip(e.text, 150))}`); break;
      case "resource-error": lines.push(`   ${at} ↳ ⚠️ failed to load ${e.tag}: ${code(shortUrl(e.url, origin))}${e.status ? ` (${e.status})` : ""}`); break;
      case "page": lines.push(`   ${at} ↳ page loaded: "${clip(e.title, 80)}" (HTML snapshot in Appendix)`); break;
      case "new-tab": lines.push(`   ${at} ↳ a new tab was opened from this page (it is recorded too)`); break;
      case "tab-closed": lines.push(`   ${at} ↳ a tab was closed`); break;
      case "stop": lines.push(`   ${at} **Recording stopped**`); break;
    }
  }
  const MAX = 4000;
  md.push(`## Timeline (step by step)\nNumbered lines are things you did; ↳ lines are what happened after.\n\n${lines.slice(0, MAX).join("\n")}${lines.length > MAX ? `\n… ${lines.length - MAX} more lines cut` : ""}`);

  if (requests.length) {
    md.push(`## All server requests (${requests.length})\n| Time | Step | Method | URL | Status | ms |\n|---|---|---|---|---|---|\n` +
      requests.slice(0, 400).map((e) => `| ${fmtT(e.t - t0)} | ${stepOf.get(e)} | ${e.method} | ${clip(shortUrl(e.url, origin), 90).replace(/\|/g, "\\|")} | ${e.status >= 400 || e.status === 0 ? `**${e.status}**` : e.status} | ${e.ms} |`).join("\n"));
  }
  const cons = events.filter((e) => e.type === "console");
  if (cons.length) md.push(`## Console messages (${cons.length})\n` + cons.slice(0, 300).map((e) => `- [${fmtT(e.t - t0)}] **${e.level}**: ${code(clip(e.text, 400))}`).join("\n"));

  if (pages.length) {
    md.push(`## Appendix – page snapshots (HTML at load time)\nScripts removed, long texts shortened, secret fields hidden.`);
    for (const p of pages.slice(0, 15)) {
      md.push(`### ${clip(p.title, 90)} — ${shortUrl(p.url, origin)}\n${p.headings.length ? "Headings: " + p.headings.map((h) => `\`${h}\``).join(" · ") + "\n\n" : ""}${p.html ? "```html\n" + p.html.trim() + "\n```" : ""}`);
    }
  }
  return { md: md.join("\n\n") + "\n", errors: errors.length + failed.length + consoleErr.length, actions: actions.length, origin, t0 };
}

(async () => {
  const events = await TraceDB.all();
  if (!events.length) { $("title").textContent = "No recording yet – click the Trace icon on a website to start."; return; }
  const r = build(events);
  let host = "site"; try { host = new URL(r.origin).hostname; } catch {}
  $("title").textContent = `Test report – ${host}`;
  $("stats").textContent = `${r.actions} actions · ${r.errors} problems · ${events.length} events`;
  $("md").value = r.md;
  const name = `test-report-${host}-${new Date(r.t0).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`;
  $("dl").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([r.md], { type: "text/markdown" })); a.download = name; a.click(); };
  $("copy").onclick = async () => { await navigator.clipboard.writeText(r.md); $("copy").textContent = "Copied ✓"; setTimeout(() => ($("copy").textContent = "Copy"), 1500); };
})();
