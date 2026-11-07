// Why? – the small bar at the top of the page (ask / remind). Injected only when shown.
(() => {
  if (window.__whyShow) return;
  let host = null, timer = null;

  function close() { clearTimeout(timer); if (host) host.remove(); host = null; }
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

  window.__whyShow = ({ mode, text = "", at }) => {
    close();
    host = document.createElement("why-bar");
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%)";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      .b { display: flex; align-items: center; gap: 8px; background: #0f766e; color: #fff; padding: 9px 10px 9px 14px; border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,.25); font: 14px system-ui, sans-serif; max-width: 92vw; }
      input { font: inherit; border: 0; border-radius: 8px; padding: 6px 9px; width: 260px; color: #111; }
      button { font: inherit; font-size: 13px; border: 0; border-radius: 8px; padding: 6px 10px; cursor: pointer; background: rgba(255,255,255,.18); color: #fff; }
      button.main { background: #fff; color: #0f766e; font-weight: 600; }
      .t { font-weight: 600; } .s { opacity: .75; font-size: 12px; }
    </style><div class="b"></div>`;
    const b = root.querySelector(".b");
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

    if (mode === "ask") {
      b.innerHTML = `<span>Why is this tab open?</span><input placeholder="e.g. compare prices, read later…" maxlength="120"><button class="main">Save</button><button class="x" title="Skip (Esc)">✕</button>`;
      const input = b.querySelector("input");
      input.value = text;
      const save = () => { chrome.runtime.sendMessage({ type: "setReason", text: input.value }); close(); };
      b.querySelector(".main").onclick = save;
      b.querySelector(".x").onclick = close;
      input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") save(); if (e.key === "Escape") close(); });
      input.addEventListener("input", () => clearTimeout(timer)); // typing = stay open
      setTimeout(() => input.focus(), 50);
      timer = setTimeout(close, 15000); // ignored? it goes away by itself
    } else {
      b.innerHTML = `<span class="s">You opened this ${esc(ago(at))} to:</span><span class="t">${esc(text)}</span>
        <button class="main done">Done – close tab</button><button class="keep">Still need it</button><button class="edit">Edit</button>`;
      b.querySelector(".done").onclick = () => chrome.runtime.sendMessage({ type: "closeTab" });
      b.querySelector(".keep").onclick = close;
      b.querySelector(".edit").onclick = () => window.__whyShow({ mode: "ask", text });
      timer = setTimeout(close, 12000);
    }
    document.documentElement.appendChild(host);
  };
})();
