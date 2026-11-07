const $ = (id) => document.getElementById(id);
(async () => {
  const words = await SRS.words();
  const all = Object.values(words);
  $("total").textContent = `${all.length} saved`;
  $("due").textContent = SRS.due(words).length;
  const recent = all.sort((a, b) => b.added - a.added).slice(0, 5);
  $("recent").innerHTML = recent.length ? "" : '<li class="muted">Double-click any English word on a website.</li>';
  for (const w of recent) {
    const li = document.createElement("li");
    const a = document.createElement("b"); a.textContent = w.word;
    const b = document.createElement("span"); b.dir = "rtl"; b.textContent = w.ar || ""; b.className = "muted";
    li.append(a, b);
    $("recent").append(li);
  }
  const open = (hash) => chrome.tabs.create({ url: chrome.runtime.getURL("review/review.html" + hash) });
  $("review").onclick = () => open("");
  $("all").onclick = () => open("#list");

  const s = await chrome.storage.sync.get(SRS.DEFAULTS);
  $("trigger").value = s.trigger;
  $("trigger").onchange = (e) => chrome.storage.sync.set({ trigger: e.target.value });
  for (const k of ["definitions", "online", "speak"]) {
    $(k).checked = s[k];
    $(k).onchange = (e) => chrome.storage.sync.set({ [k]: e.target.checked });
  }
})();
