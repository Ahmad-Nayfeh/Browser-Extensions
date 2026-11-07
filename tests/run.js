#!/usr/bin/env node
// Runs every extension test.
//   node tests/run.js              all tests
//   node tests/run.js 04 shield    only test files whose name contains "04" or "shield"
//   node tests/run.js --real       also the tests that use real websites (need internet)
// Tests marked "display" need a screen; on a server run:  xvfb-run -a node tests/run.js
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const real = args.includes("--real");
const filters = args.filter((a) => !a.startsWith("--"));
const files = fs.readdirSync(__dirname).filter((f) => /^\d\d-.+\.test\.js$/.test(f)).sort()
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)));

function checker(name) {
  const fails = [];
  const t = {
    ok(cond, msg) { if (!cond) fails.push(msg); return !!cond; },
    equal(a, b, msg) { if (a !== b) fails.push(`${msg} – expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); return a === b; },
    includes(hay, needle, msg) { const ok = String(hay).includes(needle); if (!ok) fails.push(`${msg} – "${needle}" not found`); return ok; },
    log: (...a) => { if (process.env.VERBOSE) console.log("      ", ...a); },
  };
  return { t, fails };
}

(async () => {
  const results = [];
  const started = Date.now();
  for (const f of files) {
    const cases = require(path.join(__dirname, f));
    for (const c of cases) {
      const label = `${f.replace(".test.js", "")} › ${c.name}`;
      if (c.needs === "real" && !real) { results.push({ label, status: "skip", why: "uses real websites (run with --real)" }); continue; }
      if (c.needs === "display" && !process.env.DISPLAY) { results.push({ label, status: "skip", why: "needs a screen (run with xvfb-run)" }); continue; }
      const { t, fails } = checker(label);
      const t0 = Date.now();
      let error = null;
      try {
        await Promise.race([c.run(t), new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${(c.timeout || 120000) / 1000}s`)), c.timeout || 120000))]);
      } catch (e) { error = e; }
      const ms = Date.now() - t0;
      const status = error || fails.length ? "fail" : "pass";
      results.push({ label, status, ms, fails, error });
      console.log(`${status === "pass" ? "✅" : "❌"} ${label} (${(ms / 1000).toFixed(1)}s)`);
      for (const m of fails) console.log(`     ✗ ${m}`);
      if (error) console.log(`     ✗ ${String(error.stack || error).split("\n").slice(0, 4).join("\n       ")}`);
    }
  }
  const n = (s) => results.filter((r) => r.status === s).length;
  for (const r of results.filter((r) => r.status === "skip")) console.log(`⏭️  ${r.label} – skipped: ${r.why}`);
  console.log(`\n${n("pass")} passed, ${n("fail")} failed, ${n("skip")} skipped – ${((Date.now() - started) / 1000).toFixed(0)}s`);
  process.exit(n("fail") ? 1 : 0);
})();
