const $ = (id) => document.getElementById(id);
(async () => {
  const r = await BlueprintDB.get(new URLSearchParams(location.search).get("id"));
  if (!r) { $("title").textContent = "Report not found (only the latest one is kept)"; return; }
  let host = "site"; try { host = new URL(r.url).hostname.replace(/^www\./, ""); } catch {}
  document.title = "Blueprint – " + host;
  $("title").textContent = "Blueprint – " + host;
  $("md").value = r.md;
  const kb = Math.round(new Blob([r.md]).size / 1024);
  $("stats").textContent = `${kb} KB · ${r.stats.elements} elements · ${r.stats.rules} CSS rules · ${r.stats.sheets} stylesheets · ${r.stats.ms} ms`;
  const date = new Date().toISOString().slice(0, 10);
  const save = (href, name) => { const a = document.createElement("a"); a.href = href; a.download = name; a.click(); };
  $("dlMd").onclick = () => save(URL.createObjectURL(new Blob([r.md], { type: "text/markdown" })), `blueprint-${host}-${date}.md`);
  if (r.shot && r.shot.png) {
    $("shot").src = r.shot.png;
    $("dlPng").onclick = () => save(r.shot.png, `blueprint-${host}-${date}.png`);
    if (r.shot.cut) $("note").textContent = "The page is very tall – the screenshot shows the first 16 000 px.";
  } else {
    $("dlPng").disabled = true;
    $("shotBox").hidden = true;
    if (r.shot && r.shot.error) $("note").textContent = "Screenshot failed: " + r.shot.error;
  }
  $("copy").onclick = async () => { await navigator.clipboard.writeText(r.md); $("copy").textContent = "Copied ✓"; setTimeout(() => ($("copy").textContent = "Copy Markdown"), 1500); };
})();
