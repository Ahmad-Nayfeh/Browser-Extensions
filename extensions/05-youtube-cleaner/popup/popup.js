(async () => {
  const defaults = Object.fromEntries(Object.entries(CLEAN_OPTIONS).map(([k, v]) => [k, v.def]));
  const cur = await chrome.storage.sync.get(defaults);
  const box = document.getElementById("opts");
  for (const [k, { label }] of Object.entries(CLEAN_OPTIONS)) {
    const row = document.createElement("label");
    row.className = "row";
    const text = document.createElement("span");
    text.textContent = label;
    const sw = document.createElement("span");
    sw.className = "switch";
    sw.innerHTML = '<input type="checkbox"><span></span>';
    const input = sw.querySelector("input");
    input.checked = cur[k];
    input.onchange = () => chrome.storage.sync.set({ [k]: input.checked });
    row.append(text, sw);
    box.append(row);
  }
})();
