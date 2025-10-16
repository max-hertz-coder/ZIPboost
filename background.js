// Service worker (MV3)

chrome.runtime.onInstalled.addListener(() => {
  console.log("[ZIPboost] Service worker installed");
});

// Скачивание из попапа
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  // 1) Скачивание файлов (из Compress / Extract all)
  if (msg.type === "download") {
    const { url, filename } = msg.payload || {};
    chrome.downloads.download(
      { url, filename, conflictAction: "uniquify", saveAs: false },
      (id) => sendResponse({ ok: !!id, id, lastError: chrome.runtime.lastError?.message })
    );
    return true; // async
  }

  // 2) Подхват содержимого по URL (когда пользователь перетаскивает ссылку/картинку с веб-страницы)
  if (msg.type === "FETCH_URL") {
    (async () => {
      try {
        const resp = await fetch(msg.url, { credentials: "include" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const ab = await blob.arrayBuffer();
        const name = (() => {
          try {
            const u = new URL(msg.url);
            const raw = (u.pathname.split("/").pop() || "file").split("?")[0];
            return raw || "file";
          } catch { return "file"; }
        })();
        sendResponse({
          ok: true,
          mime: blob.type || "application/octet-stream",
          name,
          buffer: Array.from(new Uint8Array(ab))
        });
      } catch (e) {
        console.warn("[ZIPboost] FETCH_URL error:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }
});
