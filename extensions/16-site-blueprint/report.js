const $ = (id) => document.getElementById(id);
(async () => {
  const r = await BlueprintDB.get(new URLSearchParams(location.search).get("id"));
  if (!r) { $("title").textContent = "Report not found (only the latest one is kept)"; return; }
  let host = "site"; try { host = new URL(r.url).hostname.replace(/^www\./, ""); } catch {}
  document.title = "Blueprint – " + host;
  $("title").textContent = "Blueprint – " + host;
  $("md").value = r.md;
  const kb = Math.round(new Blob([r.md]).size / 1024);
  $("stats").textContent = `${r.pages} page(s) · ${r.shots.length} screenshot file(s) · ${r.requests} data requests · ${kb} KB`;
  const base = `blueprint-${host}-${new Date().toISOString().slice(0, 10)}`;
  const save = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); };
  const toBlob = async (dataUrl) => (await fetch(dataUrl)).blob();
  for (const s of r.shots) {
    const f = document.createElement("figure");
    const img = document.createElement("img"); img.src = s.png; img.loading = "lazy";
    const c = document.createElement("figcaption"); c.textContent = s.name;
    f.append(img, c); $("shots").append(f);
  }
  if (!r.shots.length) $("shots").hidden = true;
  $("zip").onclick = async () => {
    $("zip").disabled = true;
    const files = [{ name: "blueprint.md", data: r.md }];
    for (const s of r.shots) files.push({ name: s.name, data: await toBlob(s.png) });
    save(await ZipWriter.makeZip(files), base + ".zip");
    $("zip").disabled = false;
  };
  $("dlMd").onclick = () => save(new Blob([r.md], { type: "text/markdown" }), base + ".md");
  $("copy").onclick = async () => { await navigator.clipboard.writeText(r.md); $("copy").textContent = "Copied ✓"; setTimeout(() => ($("copy").textContent = "Copy Markdown"), 1500); };
})();
