// Trace – runs inside the page's own JavaScript world (needed to see its
// errors, console messages and network calls). Sends what it sees to
// capture.js through a DOM event; does nothing else.
(() => {
  if (window.__traceHooked) return;
  window.__traceHooked = true;
  let on = true;
  document.addEventListener("__trace_stop", () => { on = false; });

  const send = (ev) => { if (on) try { document.dispatchEvent(new CustomEvent("__trace", { detail: JSON.stringify(ev) })); } catch {} };
  const str = (v) => {
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (typeof v === "string") return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  };
  const short = (s, n = 600) => (s && s.length > n ? s.slice(0, n) + "…" : s);
  // a failed file can be seen twice (error event + performance entry): report it once
  const failedFiles = new Set();
  const fileFailed = (ev) => { if (failedFiles.has(ev.url)) return; failedFiles.add(ev.url); send(ev); };

  // console
  for (const level of ["error", "warn", "info", "log"]) {
    const orig = console[level];
    console[level] = function (...args) {
      send({ type: "console", level, text: short(args.map(str).join(" "), 800) });
      return orig.apply(this, args);
    };
  }
  // uncaught errors
  addEventListener("error", (e) => {
    if (e.target && e.target !== window && e.target.tagName) { // a <script>/<img> failed to load
      // wait a moment: the performance entry (which knows the status code) may come too
      const ev = { type: "resource-error", tag: e.target.tagName.toLowerCase(), url: e.target.src || e.target.href || "" };
      setTimeout(() => fileFailed(ev), 300);
      return;
    }
    send({ type: "js-error", text: e.message, source: e.filename, line: e.lineno, col: e.colno, stack: short(e.error && e.error.stack, 1200) });
  }, true);
  addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    send({ type: "js-error", text: "Unhandled promise rejection: " + str(r), stack: short(r && r.stack, 1200) });
  });

  // fetch
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const t0 = performance.now();
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    const url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    try {
      const res = await origFetch.apply(this, arguments);
      const ev = { type: "request", api: "fetch", method, url: new URL(url, location.href).href, status: res.status, ms: Math.round(performance.now() - t0) };
      if (!res.ok) { try { ev.body = short(await res.clone().text(), 800); } catch {} }
      send(ev);
      return res;
    } catch (err) {
      send({ type: "request", api: "fetch", method, url, status: 0, error: str(err), ms: Math.round(performance.now() - t0) });
      throw err;
    }
  };
  // XMLHttpRequest
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__trace = { method: String(method).toUpperCase(), url: new URL(url, location.href).href }; return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    const info = this.__trace, t0 = performance.now();
    if (info) this.addEventListener("loadend", () => {
      const ev = { type: "request", api: "xhr", method: info.method, url: info.url, status: this.status, ms: Math.round(performance.now() - t0) };
      if (this.status === 0) ev.error = "network error / blocked";
      else if (this.status >= 400 && (this.responseType === "" || this.responseType === "text")) ev.body = short(this.responseText, 800);
      send(ev);
    });
    return XS.apply(this, arguments);
  };
  // images, scripts, CSS… that came back with an error status
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.responseStatus >= 400 && e.initiatorType !== "fetch" && e.initiatorType !== "xmlhttprequest") {
          fileFailed({ type: "resource-error", tag: e.initiatorType, url: e.name, status: e.responseStatus });
        }
      }
    }).observe({ type: "resource", buffered: true });
  } catch {}
})();
