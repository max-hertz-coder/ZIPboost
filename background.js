// background.js — Service Worker (MV3) for ZIPboost
'use strict';

const WELCOME_URL = 'https://max-hertz-coder.github.io/zipboost-welcome_page/';

// Открываем внешнюю Welcome Page (GitHub Pages) только при установке
chrome.runtime.onInstalled.addListener(({ reason }) => {
  try {
    if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
      chrome.tabs.create({ url: WELCOME_URL });
      console.log('[ZIPboost] Welcome page opened:', WELCOME_URL);
    } else {
      console.log('[ZIPboost] onInstalled (no welcome):', reason);
    }
  } catch (e) {
    console.warn('[ZIPboost] Failed to open welcome page:', e);
  }
});

// Скачивания из popup через сервис-воркер (надёжнее, чем напрямую из popup)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  // Инициировать загрузку файла по URL (data:, blob:, https:)
  if (msg.type === 'download') {
    const { url, filename } = msg.payload || {};
    chrome.downloads.download(
      { url, filename, conflictAction: 'uniquify', saveAs: false },
      (id) => {
        const lastError = chrome.runtime.lastError?.message;
        sendResponse({ ok: !!id, id, lastError });
      }
    );
    return true; // async response
  }

  // Проксировать fetch через сервис-воркер и вернуть бинарные данные
  if (msg.type === 'FETCH_URL') {
    (async () => {
      try {
        const resp = await fetch(msg.url, { credentials: 'include' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const ab = await blob.arrayBuffer();

        // Попытка получить имя файла из URL
        const name = (() => {
          try {
            const u = new URL(msg.url);
            const raw = (u.pathname.split('/').pop() || 'file').split('?')[0];
            return raw || 'file';
          } catch {
            return 'file';
          }
        })();

        sendResponse({
          ok: true,
          mime: blob.type || 'application/octet-stream',
          name,
          buffer: Array.from(new Uint8Array(ab)),
        });
      } catch (e) {
        console.warn('[ZIPboost] FETCH_URL error:', e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async response
  }
});

// Ловим прерванные загрузки — отправляем событие в popup, чтобы показать инструкцию
chrome.downloads.onChanged.addListener((delta) => {
  if (delta?.state?.current === 'interrupted') {
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_INTERRUPTED',
      reason: delta?.error?.current || '',
      id: delta?.id,
    });
  }
});
