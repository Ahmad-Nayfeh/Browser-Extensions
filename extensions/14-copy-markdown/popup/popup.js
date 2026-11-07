const $ = (id) => document.getElementById(id);
let tab = null, result = null, mode = "auto";

async function refresh() {
  $("out").value = "Converting…";
  result = await chrome.runtime.sendMessage({ type: "convert", tabId: tab.id, mode });
  if (!result || result.error) {
    $("out").value = "This page can't be read (browser pages, the Web Store and PDF files are not allowed).";
    $("copy").disabled = $("dl").disabled = true;
    return;
  }
  mode = result.mode;
  $("out").value = result.md;
  $("mSel").classList.toggle("primary", mode === "selection");
  $("mPage").classList.toggle("primary", mode === "page");
  $("what").textContent = `${result.md.split(/\s+/).filter(Boolean).length} words`;
}

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { header = true } = await chrome.storage.sync.get("header");
  $("header").checked = header;
  $("header").onchange = async (e) => { await chrome.storage.sync.set({ header: e.target.checked }); refresh(); };
  $("mSel").onclick = () => { mode = "selection"; refresh(); };
  $("mPage").onclick = () => { mode = "page"; refresh(); };
  $("copy").onclick = async () => {
    await navigator.clipboard.writeText($("out").value);
    $("copy").textContent = "Copied ✓";
    setTimeout(() => ($("copy").textContent = "Copy"), 1500);
  };
  $("dl").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([$("out").value], { type: "text/markdown" }));
    a.download = (result.title || "page").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) + ".md";
    a.click();
  };
  refresh();
})();
