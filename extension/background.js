// Mutes/unmutes the tab on ad-state messages. Only unmutes tabs that this
// extension muted, so a manual mute by the user is never undone.
//
// The background script is non-persistent (Firefox unloads it after ~30 s of
// inactivity, i.e. in the middle of an ad break), so no state is kept in
// variables: who muted the tab is read from tab.mutedInfo, and the on/off
// switch lives in storage.

async function isEnabled() {
  const { enabled } = await chrome.storage.local.get({ enabled: true });
  return enabled;
}

function mutedByUs(tab) {
  const m = tab.mutedInfo;
  return !!(m && m.muted && m.reason === "extension" && m.extensionId === chrome.runtime.id);
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "ad-state" || !sender.tab) return;
  handleAdState(sender.tab.id, msg.inAd);
});

async function handleAdState(tabId, inAd) {
  const enabled = await isEnabled();
  const tab = await chrome.tabs.get(tabId);

  if (inAd) {
    chrome.action.setBadgeText({ tabId, text: "AD" });
    if (enabled && !tab.mutedInfo?.muted) await chrome.tabs.update(tabId, { muted: true });
  } else {
    chrome.action.setBadgeText({ tabId, text: enabled ? "" : "OFF" });
    if (mutedByUs(tab)) await chrome.tabs.update(tabId, { muted: false });
  }
}

chrome.action.onClicked.addListener(async () => {
  const enabled = !(await isEnabled());
  await chrome.storage.local.set({ enabled });
  chrome.action.setBadgeText({ text: enabled ? "" : "OFF" });
  chrome.action.setTitle({ title: "DAZN Ad Mute: " + (enabled ? "an" : "aus") + " (klicken zum Umschalten)" });
  if (!enabled) {
    for (const tab of await chrome.tabs.query({ url: "https://*.dazn.com/*" })) {
      if (mutedByUs(tab)) chrome.tabs.update(tab.id, { muted: false });
    }
  }
});
