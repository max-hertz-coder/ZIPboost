// Service Worker (MV3)

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[ZIPboost] onInstalled:', details?.reason);
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    // Открываем локальную Welcome Page (можете заменить на Tilda-URL позже)
    chrome.tabs.create({ url: 'https://max-hertz-coder.github.io/zipboost-welcome_page/'});
    // Если у вас будет Tilda-страница, поставьте:
    // chrome.tabs.create({ url: 'https://YOUR-TILDA-DOMAIN/welcome' });
  }
});

// Скачивания из popup (надёжнее, чем из popup напрямую)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'download') {
    const { url, filename } = msg.payload || {};
    chrome.downloads.download(
      { url, filename, conflictAction: "uniquify", saveAs: false },
      (id) => {
        const lastError = chrome.runtime.lastError?.message;
        sendResponse({ ok: !!id, id, lastError });
      }
    );
    return true;
  }

  if (msg.type === 'FETCH_URL') {
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
    return true;
  }
});

// Ловим прерванные загрузки — сообщаем popup, чтобы показать инструкцию
chrome.downloads.onChanged.addListener((delta) => {
  if (delta?.state?.current === 'interrupted') {
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_INTERRUPTED',
      reason: delta?.error?.current || ''
    });
  }
});
