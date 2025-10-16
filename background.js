self.addEventListener("install", () => console.log("[ZIPboost] SW installed"));
self.addEventListener("activate", () => console.log("[ZIPboost] SW activated"));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "FETCH_FILE") {
        const resp = await fetch(msg.url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const ab = await blob.arrayBuffer();
        sendResponse({
          ok: true,
          mime: blob.type || "application/octet-stream",
          name: guessName(msg.url),
          buffer: Array.from(new Uint8Array(ab))
        });
        return;
      }
      sendResponse({ ok: false, error: "Unknown message" });
    } catch (err) {
      console.error("[ZIPboost] BG error:", err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true;
});

function guessName(url) {
  try {
    const u = new URL(url);
    return (u.pathname.split("/").pop() || "file").split("?")[0];
  } catch {
    return "file";
  }
}
