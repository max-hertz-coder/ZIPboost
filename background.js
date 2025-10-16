chrome.runtime.onInstalled.addListener(() => {
  console.log("[ZIPboost] Service worker installed");
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "download") {
    const { url, filename } = msg.payload || {};
    chrome.downloads.download(
      { url, filename, conflictAction: "uniquify", saveAs: false },
      (id) => sendResponse({ ok: !!id, id, lastError: chrome.runtime.lastError?.message })
    );
    return true; // async
  }
});
