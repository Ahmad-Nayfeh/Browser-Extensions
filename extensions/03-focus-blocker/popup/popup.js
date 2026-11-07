const $ = (id) => document.getElementById(id);
const fmt = (ms) => `${Math.floor(ms / 60000)} min`;

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try { const u = new URL(tab.url); if (/^https?:$/.test(u.protocol)) host = u.hostname.replace(/^www\./, ""); } catch {}

  async function render() {
    const { sites } = await chrome.storage.sync.get({ sites: [] });
    const usage = await chrome.runtime.sendMessage({ type: "usage" });
    const mine = sites.find((s) => host && (host === s.domain || host.endsWith("." + s.domain)));
    $("host").textContent = host || "No website in this tab";
    $("block").disabled = $("limit").disabled = !host || !!mine;
    $("status").textContent = mine ? (mine.mode === "block" ? "– blocked" : `– ${fmt(usage.used[mine.domain] || 0)} of ${mine.minutes} min used today`) : "";

    const ul = $("list");
    ul.innerHTML = "";
    if (!sites.length) ul.innerHTML = '<li class="muted">No sites yet.</li>';
    for (const s of sites) {
      const li = document.createElement("li");
      const t = document.createElement("span");
      t.textContent = s.mode === "block" ? `${s.domain} — blocked` : `${s.domain} — ${fmt(usage.used[s.domain] || 0)} / ${s.minutes} min`;
      const b = document.createElement("button");
      b.className = "danger";
      b.textContent = "Remove";
      b.onclick = async () => {
        if (!confirm(`Remove ${s.domain}? Be honest: is this a good idea right now?`)) return;
        const cur = (await chrome.storage.sync.get({ sites: [] })).sites;
        await chrome.storage.sync.set({ sites: cur.filter((x) => x.domain !== s.domain) });
        render();
      };
      li.append(t, b);
      ul.append(li);
    }
  }

  async function add(mode) {
    const { sites } = await chrome.storage.sync.get({ sites: [] });
    const minutes = Math.max(1, Math.min(600, +$("mins").value || 15));
    sites.push({ domain: host, mode, minutes });
    await chrome.storage.sync.set({ sites });
    setTimeout(render, 300);
  }
  $("block").onclick = () => add("block");
  $("limit").onclick = () => add("limit");
  render();
})();
