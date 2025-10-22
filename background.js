// Фоновый скрипт (service worker) — выполняется в фоновом режиме (Manifest V3)
chrome.runtime.onInstalled.addListener(() => {
  console.log("[ZIPboost] Сервисный воркер установлен");
});

// Слушаем сообщения от popup (всплывающего окна)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  // 1) Загрузка файлов (при сжатии или извлечении всех файлов)
  if (msg.type === "download") {
    const { url, filename } = msg.payload || {};
    chrome.downloads.download(
      { url, filename, conflictAction: "uniquify", saveAs: false },
      (id) => sendResponse({ ok: !!id, id, lastError: chrome.runtime.lastError?.message })
    );
    return true; // Оставляем канал сообщений открытым для асинхронного ответа
  }

  // 2) Получение содержимого по URL (при перетаскивании ссылки/изображения со страницы)
  if (msg.type === "FETCH_URL") {
    (async () => {
      try {
        // Делаем fetch с учётом credentials
        const resp = await fetch(msg.url, { credentials: "include" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const ab = await blob.arrayBuffer();
        // Определяем имя файла по URL
        const name = (() => {
          try {
            const u = new URL(msg.url);
            const raw = (u.pathname.split("/").pop() || "file").split("?")[0];
            return raw || "file";
          } catch {
            return "file";
          }
        })();
        // Отправляем результат обратно popup
        sendResponse({
          ok: true,
          mime: blob.type || "application/octet-stream",
          name,
          buffer: Array.from(new Uint8Array(ab)) // байты файла
        });
      } catch (e) {
        console.warn("[ZIPboost] Ошибка FETCH_URL:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // Будет отправлен асинхронный ответ
  }
});
