const send = (msg) => chrome.runtime.sendMessage(msg);
const NAMES = { easylist: "EasyList (ads)", easyprivacy: "EasyPrivacy (trackers)", peterlowe: "Peter Lowe's list (ad servers)", youtube: "YouTube ads (built-in)" };

function li(text, onRemove) {
  const el = document.createElement("li");
  const span = document.createElement("span");
  span.textContent = text;
  const b = document.createElement("button");
  b.className = "danger";
  b.textContent = "Remove";
  b.onclick = onRemove;
  el.append(span, b);
  return el;
}

async function render() {
  const s = await send({ type: "getState" });
  const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
  const lists = document.getElementById("lists");
  lists.innerHTML = "";
  for (const r of chrome.runtime.getManifest().declarative_net_request.rule_resources) {
    const d = document.createElement("div");
    d.textContent = `${enabled.includes(r.id) ? "✔" : "✖"}  ${NAMES[r.id] || r.id}`;
    lists.append(d);
  }
  const note = document.createElement("p");
  note.className = "muted small";
  note.textContent = "Lists are bundled with the extension. To update them run: python3 tools/build_filters.py adblock — then reload the extension.";
  lists.append(note);

  const allow = document.getElementById("allow");
  allow.innerHTML = "";
  if (!s.allowlist.length) allow.innerHTML = '<li class="muted">None</li>';
  for (const h of s.allowlist) allow.append(li(h, async () => { await send({ type: "removeAllowed", host: h }); render(); }));

  const user = document.getElementById("user");
  user.innerHTML = "";
  const entries = Object.entries(s.userFilters);
  if (!entries.length) user.innerHTML = '<li class="muted">None – use “Hide an element” in the popup.</li>';
  for (const [h, sels] of entries)
    for (const sel of sels)
      user.append(li(`${h}  ##  ${sel}`, async () => { await send({ type: "removeUserFilter", host: h, selector: sel }); render(); }));
}
render();
