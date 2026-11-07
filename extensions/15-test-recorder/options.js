const DEF = { maskAll: false, logs: false, html: true, shots: true, visual: true };
chrome.storage.sync.get(DEF).then((o) => {
  for (const k of Object.keys(DEF)) {
    const el = document.getElementById(k);
    el.checked = o[k];
    el.onchange = () => chrome.storage.sync.set({ [k]: el.checked });
  }
});
