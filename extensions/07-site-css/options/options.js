const $ = (id) => document.getElementById(id);
let timer = null;
const later = (fn) => { clearTimeout(timer); timer = setTimeout(fn, 400); };

async function render() {
  const { styles, global } = await loadStyles();
  $("gon").checked = global.on;
  $("gcss").value = global.css;
  const box = $("sites");
  box.innerHTML = "";
  const hosts = Object.keys(styles).sort();
  if (!hosts.length) box.innerHTML = '<p class="muted">No site styles yet – open a site and click the Restyle icon.</p>';
  for (const h of hosts) {
    const card = document.createElement("div");
    card.className = "card stack";
    card.innerHTML = `<div class="row"><b></b><span><label class="switch"><input type="checkbox"><span></span></label> <button class="danger">Delete</button></span></div><textarea spellcheck="false"></textarea>`;
    card.querySelector("b").textContent = h;
    const on = card.querySelector("input");
    const ta = card.querySelector("textarea");
    on.checked = styles[h].on;
    ta.value = styles[h].css;
    const save = async () => {
      const s = await loadStyles();
      s.styles[h] = { css: ta.value, on: on.checked };
      await chrome.storage.local.set({ styles: s.styles });
    };
    on.onchange = save;
    ta.oninput = () => later(save);
    card.querySelector("button").onclick = async () => {
      if (!confirm(`Delete the CSS for ${h}?`)) return;
      const s = await loadStyles();
      delete s.styles[h];
      await chrome.storage.local.set({ styles: s.styles });
      render();
    };
    box.append(card);
  }
}

const saveGlobal = () => chrome.storage.local.set({ global: { css: $("gcss").value, on: $("gon").checked } });
$("gon").onchange = saveGlobal;
$("gcss").oninput = () => later(saveGlobal);

$("export").onclick = async () => {
  const data = await loadStyles();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = "restyle-backup.json";
  a.click();
};
$("import").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    if (typeof data.styles !== "object") throw new Error("not a Restyle backup");
    const cur = await loadStyles();
    await chrome.storage.local.set({ styles: { ...cur.styles, ...data.styles }, global: data.global || cur.global });
    render();
    alert("Imported ✓");
  } catch (err) { alert("Import failed: " + err.message); }
};
render();
