const $ = (id) => document.getElementById(id);
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let queue = [], current = null;

function speak(w) { const u = new SpeechSynthesisUtterance(w); u.lang = "en-US"; speechSynthesis.cancel(); speechSynthesis.speak(u); }

async function loadQueue() {
  queue = SRS.due(await SRS.words()).sort((a, b) => a.due - b.due);
  next();
}

function next() {
  current = queue.shift() || null;
  $("answer").hidden = $("grades").hidden = true;
  $("showBtn").hidden = $("sayBtn").hidden = !current;
  if (!current) {
    $("left").textContent = "";
    $("word").textContent = "All done for now 🎉";
    $("ph").textContent = "";
    $("ctx").textContent = "Double-click words on any website to add more. Come back later for the next review.";
    return;
  }
  $("left").textContent = `${queue.length + 1} left`;
  $("word").textContent = current.word;
  $("ph").textContent = current.phonetic || "";
  // the sentence where you met the word, with the word highlighted
  const ctx = esc(current.context || "");
  $("ctx").innerHTML = ctx.replace(new RegExp(`\\b(${current.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i"), "<mark>$1</mark>");
}

function reveal() {
  if (!current) return;
  $("ar").textContent = current.ar || "—";
  $("more").innerHTML = (current.more || []).map((m) => `<span class="muted">${esc(m.pos)}:</span> ${m.list.map(esc).join("، ")}`).join("<br>");
  $("def").innerHTML = (current.meanings || []).map((m) => `<div><b>${esc(m.pos)}</b> ${esc(m.def)}</div>`).join("");
  $("answer").hidden = $("grades").hidden = false;
  $("showBtn").hidden = true;
}

async function grade(g) {
  if (!current || $("grades").hidden) return;
  const words = await SRS.words();
  const k = SRS.key(current.word);
  if (words[k]) { SRS.grade(words[k], g); await SRS.save(words); }
  if (g === "again") queue.push(words[k] || current); // see it again in this session
  next();
}

$("showBtn").onclick = reveal;
$("sayBtn").onclick = () => current && speak(current.word);
$("grades").onclick = (e) => { const b = e.target.closest("[data-g]"); if (b) grade(b.dataset.g); };
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input")) return;
  if (e.key === " ") { e.preventDefault(); reveal(); }
  const g = { 1: "again", 2: "hard", 3: "good", 4: "easy" }[e.key];
  if (g) grade(g);
});

// ---------- word list ----------
const when = (t) => { const d = Math.round((t - Date.now()) / 864e5); return t <= Date.now() ? "now" : d < 1 ? "today" : `in ${d} day${d > 1 ? "s" : ""}`; };
async function renderList() {
  const q = $("q").value.trim().toLowerCase();
  const list = Object.values(await SRS.words()).filter((w) => !q || (w.word + " " + (w.ar || "")).toLowerCase().includes(q)).sort((a, b) => b.added - a.added);
  $("rows").innerHTML = list.length ? "" : '<tr><td colspan="5" class="muted">No words yet.</td></tr>';
  for (const w of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><b>${esc(w.word)}</b><div class="muted small">${esc(w.context || "").slice(0, 90)}</div></td><td dir="rtl">${esc(w.ar)}</td><td>${w.box}/${SRS.WAIT.length - 1}</td><td>${when(w.due)}</td><td><button class="danger">Delete</button></td>`;
    tr.querySelector("button").onclick = async () => {
      const words = await SRS.words();
      delete words[SRS.key(w.word)];
      await SRS.save(words);
      renderList();
    };
    $("rows").append(tr);
  }
}
$("q").oninput = renderList;
$("csv").onclick = async () => {
  const cell = (s) => `"${String(s || "").replace(/"/g, '""')}"`;
  const lines = Object.values(await SRS.words()).map((w) => [w.word, w.ar, (w.meanings || []).map((m) => m.def).join(" | "), w.context].map(cell).join(","));
  const blob = new Blob(["﻿" + ["word,arabic,definition,context", ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "lexi-words.csv";
  a.click();
};

document.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("[data-v]").forEach((x) => x.classList.toggle("on", x === b));
  $("review").hidden = b.dataset.v !== "review";
  $("list").hidden = b.dataset.v !== "list";
  if (b.dataset.v === "list") renderList(); else loadQueue();
}));
if (location.hash === "#list") document.querySelector('[data-v="list"]').click();
else loadQueue();
