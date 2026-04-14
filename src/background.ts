console.log("Redact-It service worker started.");

chrome.runtime.onInstalled.addListener((details) => {
  console.log("Redact-It installed.", details.reason);

  chrome.contextMenus.create({
    id: "redact-it-open",
    title: "Redact with Redact-It",
    contexts: ["image"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "redact-it-open" && tab?.id != null) {
    // TODO: pass image srcUrl to content script / editor
    console.log("Context menu clicked", info.srcUrl);
  }
});
