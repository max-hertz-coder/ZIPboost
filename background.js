// Service Worker (background script) - runs in the background (Manifest V3)

chrome.runtime.onInstalled.addListener(() => {
  console.log("[ZIPboost] Service worker installed");
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  // 1) Handle file downloads (from "Compress" or "Extract All" actions)
  if (msg.type === "download") {
    const { url, filename } = msg.payload || {};
    chrome.downloads.download(
      { url, filename, conflictAction: "uniquify", saveAs: false },
      (id) => sendResponse({ ok: !!id, id, lastError: chrome.runtime.lastError?.message })
    );
    return true; // Keep the message channel open for sendResponse (asynchronous)
  }

  // 2) Fetch content by URL (when user drags a link/image from a web page into the extension)
  if (msg.type === "FETCH_URL") {
    (async () => {
      try {
        const resp = await fetch(msg.url, { credentials: "include" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const ab = await blob.arrayBuffer();
        // Derive a filename from URL if possible
        const name = (() => {
          try {
            const u = new URL(msg.url);
            const raw = (u.pathname.split("/").pop() || "file").split("?")[0];
            return raw || "file";
          } catch {
            return "file";
          }
        })();
        sendResponse({
          ok: true,
          mime: blob.type || "application/octet-stream",
          name,
          buffer: Array.from(new Uint8Array(ab))  // send raw bytes back to popup
        });
      } catch (e) {
        console.warn("[ZIPboost] FETCH_URL error:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // Indicate that we'll send a response asynchronously
  }
});
