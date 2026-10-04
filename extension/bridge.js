// Isolated-world content script: forwards ad state from page-hook.js to the background.
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.source !== "dazn-ad-mute") return;
  chrome.runtime.sendMessage({ type: "ad-state", inAd: !!e.data.inAd, id: e.data.id });
});
