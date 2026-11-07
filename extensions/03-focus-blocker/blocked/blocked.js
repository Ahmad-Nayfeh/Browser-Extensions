const p = new URLSearchParams(location.search);
document.getElementById("site").textContent = p.get("d") || "This site";
document.getElementById("why").textContent = p.get("m") === "limit"
  ? "has used up its time for today. It opens again after midnight."
  : "is blocked.";
const quotes = [
  "What you do today is what you become tomorrow.",
  "Small focused steps beat big distracted ones.",
  "The task you are avoiding is the one that matters.",
  "Close this tab and do one useful thing for 10 minutes.",
];
document.getElementById("quote").textContent = quotes[Math.floor(Math.random() * quotes.length)];
