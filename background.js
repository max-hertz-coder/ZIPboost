self.addEventListener('install', () => {
  console.log('[ZIPboost] service worker installed');
});
self.addEventListener('activate', () => {
  console.log('[ZIPboost] service worker activated');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === "FETCH_FILE") {
        const resp = await fetch(message.url, { credentials: "include" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const ab = await blob.arrayBuffer();
        sendResponse({
          ok: true,
          mime: blob.type || "",
          name: guessName(message.url),
          buffer: Array.from(new Uint8Array(ab))
        });
        return;
      }
      if (message?.type === "CHECK_SUBSCRIPTION") {
        sendResponse({ ok: true, subscribed: true }); // заглушка
        return;
      }
      sendResponse({ ok: false, error: "Unknown message" });
    } catch (e) {
      console.error("[ZIPboost] BG error:", e);
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // async response
});

function guessName(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || "file";
    return last.split("?")[0] || "file";
  } catch {
    const parts = String(url).split("/");
    return parts[parts.length - 1] || "file";
  }
}
