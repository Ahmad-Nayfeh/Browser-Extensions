chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type !== "offscreen-copy") return;
  const t = document.getElementById("t");
  t.value = msg.text;
  t.select();
  document.execCommand("copy");
  reply(true);
});
