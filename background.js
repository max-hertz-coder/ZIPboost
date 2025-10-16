// MV3 service worker (минимальный). Нужен для стабильного вызова chrome.downloads из попапа.
chrome.runtime.onInstalled.addListener(() => {
  // ничего не делаем — но файл обязателен, т.к. указан в манифесте
});

// Прокси для скачиваний: из pop-up посылаем message, тут запускаем chrome.downloads.download
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'download') {
    const { url, filename } = msg.payload || {};
    chrome.downloads.download(
      { url, filename, conflictAction: 'uniquify', saveAs: false },
      (id) => sendResponse({ ok: !!id, id, lastError: chrome.runtime.lastError?.message })
    );
    return true; // async response
  }
});
