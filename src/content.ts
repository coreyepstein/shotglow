console.log("Redact-It content script loaded.");

// TODO: listen for messages from background service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("Redact-It content received message", message);
  sendResponse({ status: "ok" });
});
