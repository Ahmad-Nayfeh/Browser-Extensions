document.querySelectorAll("[data-mode]").forEach((b) => {
  b.onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    document.querySelectorAll("button").forEach((x) => (x.disabled = true));
    document.getElementById("msg").textContent = "Capturing…";
    const r = await chrome.runtime.sendMessage({ type: "capture", mode: b.dataset.mode, tab });
    if (r && r.ok) window.close();
    else {
      document.getElementById("msg").textContent = "Can't capture this page: " + (r && r.error);
      document.querySelectorAll("button").forEach((x) => (x.disabled = false));
    }
  };
});
