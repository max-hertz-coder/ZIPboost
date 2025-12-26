// ZIPboost — popup logic (MV3)
// - DnD + file input для сжатия и просмотра
// - ZIP: JSZip
// - RAR/7Z/TAR: libarchive.js (если присутствует)
// - Темы: dark/light с сохранением в chrome.storage.local
// - Инструкции при ограничениях браузера

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

let currentArchiveFile = null;
let archiveAPI = null; // libarchive handler
let currentZipJS = null; // JSZip instance for ZIP view
let filesToCompress = [];
let currentArchiveName = null;
let currentArchiveEntries = null;
let downloadQueue = [];

// ---------- Storage helpers ----------
const storageGet = (keys) => new Promise(r => chrome.storage?.local.get(keys, r));
const storageSet = (obj) => new Promise(r => chrome.storage?.local.set(obj, r));

// ---------- Filter macOS/Windows system files ----------
function isSystemFile(path) {
  const name = path.split('/').pop();
  return path.startsWith('__MACOSX/') || path.includes('/__MACOSX/') || name.startsWith('._') || name === '.DS_Store' || name === 'Thumbs.db';
}

// ---------- Persist / Restore ----------
async function saveState(statePatch = {}) {
  const cur = (await storageGet(['zipboost_state'])).zipboost_state || {};
  const next = { ...cur, ...statePatch };
  
  // Сохраняем активную вкладку
  const tabCompress = $('#tab-compress');
  const secCompress = $('#sec-compress');
  if (tabCompress && secCompress) {
    next.activeTab = secCompress.classList.contains('active') ? 'compress' : 'view';
  }
  
  // Сохраняем настройки сжатия
  const nameInput = $('#zip-name');
  if (nameInput) next.zipName = nameInput.value;
  
  await storageSet({ zipboost_state: next });
  return next;
}

async function loadState() {
  const res = (await storageGet(['zipboost_state'])).zipboost_state || null;
  return res;
}

async function restoreState() {
  const state = await loadState();
  if (!state) return;
  
  // Восстанавливаем активную вкладку
  const tabCompress = $('#tab-compress');
  const tabView = $('#tab-view');
  const secCompress = $('#sec-compress');
  const secView = $('#sec-view');
  
  if (state.activeTab === 'view' && tabView && secView) {
    tabCompress?.classList.remove('active');
    tabView.classList.add('active');
    secCompress?.classList.remove('active');
    secView.classList.add('active');
  } else if (state.activeTab === 'compress' && tabCompress && secCompress) {
    tabView?.classList.remove('active');
    tabCompress.classList.add('active');
    secView?.classList.remove('active');
    secCompress.classList.add('active');
  }
  
  // Восстанавливаем настройки сжатия
  const nameInput = $('#zip-name');
  if (nameInput && state.zipName) nameInput.value = state.zipName;
  
  // Восстанавливаем архив если он был открыт
  if (window._restoreArchive) {
    await window._restoreArchive();
  }
  
  // Обновляем список файлов для сжатия (если они были)
  if (filesToCompress.length > 0 && window._renderCompressList) {
    setTimeout(() => {
      window._renderCompressList();
    }, 100);
  }
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async () => {
  bindTabs();
  bindTheme();
  bindCompressUI();
  bindViewUI();
  bindRatingWidget();
  maybeInitLibArchive(); // try to init libarchive if bundled
  // Убрано сообщение о libarchive
  // $('#lib-status').textContent = archiveAPI ? 'libarchive: enabled' : 'libarchive: not found (ZIP only)';
  
  // Восстанавливаем состояние после того, как UI привязан
  await restoreState();
  
  // Сохраняем перед закрытием popup
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
      await saveState();
      resetVolatileBuffers();
    }
  });
  
  // Периодическое сохранение (на случай если visibilitychange не сработает)
  setInterval(() => saveState(), 3000);
});

function resetVolatileBuffers() {
  filesToCompress = [];
  currentArchiveFile = null;
  currentZipJS = null;
  currentArchiveEntries = null;
  downloadQueue = [];
}

// ---------- Tabs ----------
function bindTabs() {
  const tabCompress = $('#tab-compress');
  const tabView = $('#tab-view');
  const secCompress = $('#sec-compress');
  const secView = $('#sec-view');

  const activate = async (name) => {
    if (name === 'compress') {
      tabCompress.classList.add('active'); tabView.classList.remove('active');
      secCompress.classList.add('active'); secView.classList.remove('active');
    } else {
      tabView.classList.add('active'); tabCompress.classList.remove('active');
      secView.classList.add('active'); secCompress.classList.remove('active');
    }
    await saveState({ activeTab: name });
  };

  tabCompress.addEventListener('click', () => activate('compress'));
  tabView.addEventListener('click', () => activate('view'));
}

// ---------- Theme ----------
function bindTheme() {
  const btn = $('#btn-theme');
  const icon = $('#theme-icon');

  // apply saved
  chrome.storage?.local.get('theme', ({ theme }) => {
    setTheme(theme || 'dark');
  });

  btn.addEventListener('click', async () => {
    const next = (document.body.classList.contains('light')) ? 'dark' : 'light';
    setTheme(next);
    try { await chrome.storage.local.set({ theme: next }); } catch {}
  });

  function setTheme(mode) {
    if (mode === 'light') {
      document.body.classList.add('light');
      icon.textContent = '☀️';
    } else {
      document.body.classList.remove('light');
      icon.textContent = '🌙';
    }
  }
}

// ---------- Rating Widget ----------
function bindRatingWidget() {
  // TODO: Замените эту ссылку на вашу Google-форму для негативных отзывов (1-3 звезды)
  const GOOGLE_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSd2LnWqNaXblnEm_RmtTbo3hUBp4b54_QaAPTbnRMvPOp7ZUg/viewform?usp=publish-editor';
  
  // Получаем ID расширения для формирования ссылки на CWS
  const extensionId = chrome.runtime.id;
  const CWS_REVIEWS_URL = `https://chromewebstore.google.com/detail/%D1%81%D0%BE%D0%B7%D0%B4%D0%B0%D1%82%D1%8C-zip-%D1%84%D0%B0%D0%B9%D0%BB/holbdgggpngcjloephdibcobkojceehj/reviews`;
  
  const ratingLinks = $$('.rating-link');
  const ratingGroup = $('.rating-group');
  const ratingInputs = $$('input[name="rating"]');
  
  // Функция для выделения звезд слева направо
  function highlightStars(upToRating) {
    // Сначала снимаем все выделения
    ratingLinks.forEach(link => link.classList.remove('active'));
    
    // Затем выделяем звезды слева направо до выбранной включительно
    ratingLinks.forEach((link) => {
      const linkRating = parseInt(link.dataset.rating, 10);
      if (linkRating <= upToRating) {
        link.classList.add('active');
      }
    });
  }
  
  // Сброс выделения
  function resetHighlight() {
    const checkedRadio = $('input[name="rating"]:checked');
    if (checkedRadio) {
      const checkedRating = parseInt(checkedRadio.value, 10);
      highlightStars(checkedRating);
    } else {
      ratingLinks.forEach(link => link.classList.remove('active'));
    }
  }
  
  // Слушаем изменения radio кнопок
  ratingInputs.forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked) {
        const rating = parseInt(input.value, 10);
        highlightStars(rating);
      }
    });
  });
  
  // Обработка клика
  ratingLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const rating = parseInt(link.dataset.rating, 10);
      
      // Выбираем соответствующий radio button
      const radio = $(`#rating-${rating}`);
      if (radio) {
        radio.checked = true;
        highlightStars(rating);
      }
      
      // Редирект в зависимости от рейтинга
      let targetUrl;
      if (rating >= 4) {
        // 4 или 5 звезд - редирект на страницу отзывов в CWS
        targetUrl = CWS_REVIEWS_URL;
      } else {
        // 1, 2 или 3 звезды - редирект на Google-форму
        targetUrl = GOOGLE_FORM_URL;
      }
      
      // Открываем ссылку в новой вкладке
      window.open(targetUrl, '_blank');
    });
    
    // Обработка наведения
    link.addEventListener('mouseenter', () => {
      const rating = parseInt(link.dataset.rating, 10);
      highlightStars(rating);
    });
  });
  
  // Сброс при уходе мыши
  if (ratingGroup) {
    ratingGroup.addEventListener('mouseleave', resetHighlight);
  }
  
  // Инициализация при загрузке
  resetHighlight();
}

// ---------- Helpers ----------
const fmt = (bytes) =>
  bytes < 1024 ? `${bytes} B` :
  bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` :
  bytes < 1073741824 ? `${(bytes/1048576).toFixed(1)} MB` :
  `${(bytes/1073741824).toFixed(1)} GB`;

// Check if file extension is a text-based format that should NOT use octet-stream
const isTextBasedExt = (ext) => {
  const textExts = ['txt', 'md', 'rtf', 'html', 'htm', 'xml', 'css', 'js', 'json', 'csv', 'log',
    'py', 'java', 'cpp', 'c', 'h', 'ts', 'tsx', 'jsx', 'sh', 'bat', 'yml', 'yaml', 'ini', 'cfg'];
  return textExts.includes(ext.toLowerCase());
};

// Get MIME type from file extension
// Uses application/octet-stream for binary files to prevent Chrome from changing extensions
const extMime = (name) => {
  const ext = (name.split(".").pop() || "").toLowerCase();

  // For text-based files, return appropriate text MIME type
  const textMimes = {
    txt:"text/plain", md:"text/markdown", rtf:"application/rtf",
    html:"text/html", htm:"text/html", xml:"text/xml",
    css:"text/css", js:"text/javascript", json:"application/json",
    csv:"text/csv", log:"text/plain",
    py:"text/x-python", java:"text/x-java", cpp:"text/x-c++src", c:"text/x-csrc",
    ts:"text/typescript", tsx:"text/tsx", jsx:"text/jsx",
    sh:"application/x-sh", bat:"application/bat",
    yml:"text/yaml", yaml:"text/yaml", ini:"text/plain", cfg:"text/plain"
  };

  if (textMimes[ext]) {
    return textMimes[ext];
  }

  // For ALL binary files (PDF, images, documents, archives, etc.),
  // use application/octet-stream to prevent Chrome from MIME-sniffing
  // and changing the file extension
  return "application/octet-stream";
};

function showWarning(kind, extra='') {
  const box = $('#env-warnings');
  let html = '';
  if (kind === 'multi') {
    html = `
      <h4>Downloads are blocked by browser</h4>
      <ul>
        <li>Allow multiple automatic downloads for this extension:
          <br />Open <b>chrome://settings/content/automaticDownloads</b> and add ZIPboost to exceptions.</li>
        <li>Disable "Ask where to save each file" in <b>chrome://settings/downloads</b>.</li>
        <li>Temporarily disable ad blockers that can block <code>blob:</code> downloads.</li>
      </ul>`;
  } else if (kind === 'blob') {
    html = `
      <h4>Blob URL download seems blocked</h4>
      <ul>
        <li>Disable ad blockers (uBlock/AdBlock) for this extension popup.</li>
        <li>Try "Download all" again after whitelisting.</li>
      </ul>`;
  } else {
    html = `<h4>Notice</h4><div>${extra}</div>`;
  }
  box.innerHTML = html;
  box.hidden = false;
}

// ---------- libarchive init (RAR/7Z/TAR support) ----------
async function maybeInitLibArchive() {
  // libarchive.js exposes global Archive once worker is set
  if (typeof Archive === 'undefined') return false;
  try {
    await Archive.init({
      workerUrl: chrome.runtime.getURL('libs/libarchive/worker-bundle.js')
    });
    archiveAPI = Archive;
    return true;
  } catch (e) {
    console.warn('Archive.init failed', e);
    archiveAPI = null;
    return false;
  }
}

function isZipName(name='') {
  return /\.zip$/i.test(name);
}
function isSupportedByArchive(name='') {
  return /\.(rar|7z|tar|tgz|tar\.gz)$/i.test(name);
}

// ---------- Compress UI ----------
function bindCompressUI() {
  const dz = $('#dz-compress');
  const inp = $('#inp-compress');
  const list = $('#list-compress');
  const btn = $('#btn-compress');

  const nameInput = $('#zip-name');

  // DnD
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', async (e) => {
    e.preventDefault(); dz.classList.remove('drag-over');
    if (e.dataTransfer.files?.length) {
      const added = Array.from(e.dataTransfer.files);
      filesToCompress = filesToCompress.concat(added);
      renderCompressList();
      await saveState();
    }
  });
  dz.addEventListener('click', () => inp.click());
  inp.addEventListener('change', async () => {
    if (inp.files?.length) {
      const added = Array.from(inp.files);
      filesToCompress = filesToCompress.concat(added);
      renderCompressList();
      await saveState();
    }
    inp.value = '';
  });

  function renderCompressList() {
    list.innerHTML = '';
    filesToCompress.forEach((f, idx) => {
      const row = document.createElement('div');
      row.className = 'item file';
      row.innerHTML = `
        <div class="name">${f.name}</div>
        <div class="meta">${fmt(f.size)}</div>
        <div class="file-actions">
          <button class="xs" data-idx="${idx}">×</button>
        </div>`;
      list.appendChild(row);
    });
    $$('.item .xs', list).forEach(btn => {
      btn.addEventListener('click', async () => {
        const i = +btn.dataset.idx;
        filesToCompress.splice(i, 1);
        renderCompressList();
        await saveState();
      });
    });
  }
  
  // Сохраняем функцию рендеринга для восстановления
  window._renderCompressList = renderCompressList;
  
  // Восстанавливаем список файлов при загрузке
  if (filesToCompress.length > 0) {
    renderCompressList();
  }
  
  // Сохраняем при изменении имени архива или пресета
  if (nameInput) {
    nameInput.addEventListener('input', () => saveState());
  }
  btn.addEventListener('click', async () => {
    if (!filesToCompress.length) {
      alert('No files selected.'); return;
    }

    // Pre-compressed file extensions - use STORE (no compression) for these
    const preCompressedExts = new Set([
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif',  // images
      'mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'm4v',      // video
      'mp3', 'aac', 'ogg', 'flac', 'wma', 'm4a', 'opus',            // audio
      'zip', 'rar', '7z', 'gz', 'bz2', 'xz', 'zst', 'lz4', 'tar.gz', 'tgz', // archives
      'pdf', 'docx', 'xlsx', 'pptx',                                 // office (already compressed)
      'woff', 'woff2',                                               // fonts
    ]);
    const getExt = (name) => (name.split('.').pop() || '').toLowerCase();
    const isPreCompressed = (name) => preCompressedExts.has(getExt(name));

    const outName = (nameInput.value || 'archive.zip').replace(/[\/\\:*?"<>|]/g, '_');

    btn.disabled = true;
    $('#progress').textContent = 'Compressing...';

    try {
      const zip = new JSZip();
      // Add files with appropriate compression
      filesToCompress.forEach(f => {
        if (isPreCompressed(f.name)) {
          // STORE = no compression for already-compressed files
          zip.file(f.name, f, { compression: "STORE" });
        } else {
          // Level 1 = fastest DEFLATE compression
          zip.file(f.name, f, { compression: "DEFLATE", compressionOptions: { level: 1 } });
        }
      });
      const blob = await zip.generateAsync({
        type: 'blob',
        streamFiles: true
      });
      const blobUrl = URL.createObjectURL(blob);

      // Пытаемся скачать через background (надёжнее под MV3)
      const resp = await chrome.runtime.sendMessage({
        type: 'download',
        payload: { url: blobUrl, filename: outName }
      });
      if (!resp?.ok) {
        // Фоллбэк через <a download>
        try {
          const a = document.createElement('a');
          a.href = blobUrl; a.download = outName;
          document.body.appendChild(a); a.click(); a.remove();
        } catch {
          showWarning('blob');
        }
      }
      setTimeout(()=>URL.revokeObjectURL(blobUrl), 5000);
      $('#progress').textContent = 'Done.';
    } catch (e) {
      console.error(e);
      alert('Compression error: ' + e.message);
    } finally {
      btn.disabled = false;
      setTimeout(()=>$('#progress').textContent='', 2000);
    }
  });
}

// ---------- View/Extract UI ----------
function bindViewUI() {
  const dz = $('#dz-view');
  const inp = $('#inp-zip');
  const list = $('#list-zip');
  const meta = $('#zip-meta');

  $('#btn-clear-state').addEventListener('click', async () => {
    list.innerHTML = ''; 
    meta.textContent = ''; 
    currentArchiveFile = null; 
    currentZipJS = null;
    currentArchiveEntries = null;
    downloadQueue = [];
    await storageSet({ zipboost_state: null });
  });

  $('#btn-reopen-zip').addEventListener('click', () => {
    if (currentArchiveFile) openArchive(currentArchiveFile);
  });

  $('#btn-extract-all').addEventListener('click', async () => {
    if (!currentArchiveFile) {
      alert('Open an archive first.'); return;
    }
    try {
      await extractAll(currentArchiveFile);
    } catch (e) {
      console.error(e);
      alert('Extract error: ' + e.message);
    }
  });

  // DnD
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('drag-over');
    if (e.dataTransfer.files?.length) {
      const file = e.dataTransfer.files[0];
      openArchive(file);
    }
  });
  dz.addEventListener('click', () => inp.click());
  inp.addEventListener('change', () => {
    if (inp.files?.length) openArchive(inp.files[0]);
  });

  async function openArchive(file) {
    currentArchiveFile = file;
    meta.textContent = `Archive: ${file.name} — ${fmt(file.size)}`;
    downloadQueue = [];
    list.innerHTML = '';

    if (isZipName(file.name)) {
      // Use JSZip
      const ab = await file.arrayBuffer();
      currentZipJS = await JSZip.loadAsync(ab);
      currentArchiveEntries = Object.keys(currentZipJS.files);
      downloadQueue = currentArchiveEntries.filter((name) => {
        const entry = currentZipJS.files[name];
        return entry && !entry.dir && !isSystemFile(name);
      });
      renderDownloadQueue();
      updateMetaSummary();
      await saveState();
      return;
    }

    if (isSupportedByArchive(file.name)) {
      if (!archiveAPI) {
        showWarning('', 'Advanced formats require libarchive files. Please add libs/libarchive/* as described.');
        return;
      }
      const archive = await archiveAPI.open(file);
      const filesObj = await archive.getFilesObject(); // map: name -> CompressedFile
      currentArchiveEntries = Object.keys(filesObj);
      downloadQueue = currentArchiveEntries.filter((name) => !name.endsWith('/') && !isSystemFile(name));
      renderDownloadQueue();
      updateMetaSummary();
      await saveState();
      return;
    }

    alert('Unsupported format. Please open ZIP/RAR/7Z/TAR.');
  }
  
  // Восстанавливаем архив при загрузке (будет вызвано из restoreState после загрузки DOM)
  const restoreArchive = async () => {
    if (currentZipJS && currentArchiveFile) {
      if (isZipName(currentArchiveFile.name)) {
        meta.textContent = `Archive: ${currentArchiveFile.name} — ${fmt(currentArchiveFile.size)}`;
        renderDownloadQueue();
      }
    }
  };
  
  // Сохраняем функцию для вызова после загрузки состояния
  window._restoreArchive = restoreArchive;

  function renderDownloadQueue() {
    list.innerHTML = '';
    if (!downloadQueue.length) {
      list.innerHTML = `<div class="meta">No files selected. Use Reopen to reload the archive.</div>`;
      return;
    }
    downloadQueue.forEach((path) => {
      const row = document.createElement('div');
      row.className = 'item file';
      row.innerHTML = `
        <div class="name" title="${path}">${path}</div>
        <div class="meta">${getEntrySize(path)}</div>
        <div class="file-actions">
          <button class="secondary xs file-download" data-path="${path}" title="Download">⬇</button>
          <button class="secondary xs file-remove" data-path="${path}" title="Remove">✕</button>
        </div>`;
      list.appendChild(row);
    });

    $$('.file-download', list).forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = btn.dataset.path;
        await downloadSingleFile(path);
      });
    });

    $$('.file-remove', list).forEach(btn => {
      btn.addEventListener('click', () => {
        const path = btn.dataset.path;
        downloadQueue = downloadQueue.filter((p) => p !== path);
        renderDownloadQueue();
        updateMetaSummary();
      });
    });
  }

  function updateMetaSummary() {
    if (!meta) return;
    if (!currentArchiveFile) {
      meta.textContent = '';
      return;
    }
    const base = `Archive: ${currentArchiveFile.name} — ${fmt(currentArchiveFile.size)}`;
    const extra = `${downloadQueue.length} file${downloadQueue.length === 1 ? '' : 's'} selected`;
    meta.textContent = `${base} • ${extra}`;
  }

  function getEntrySize(path) {
    if (currentZipJS && currentZipJS.files?.[path]) {
      const entry = currentZipJS.files[path];
      if (entry._data && entry._data.uncompressedSize) {
        return fmt(entry._data.uncompressedSize);
      }
      if (entry.uncompressedSize) return fmt(entry.uncompressedSize);
    }
    return '';
  }

  async function downloadSingleFile(path) {
    if (!currentArchiveFile) {
      alert('Open an archive first.');
      return;
    }

    if (isZipName(currentArchiveFile.name) && currentZipJS) {
      const entry = currentZipJS.files[path];
      if (!entry || entry.dir) return;
      const ab = await entry.async('arraybuffer');
      const mimeType = extMime(path);
      const justName = path.split('/').pop().split('\\').pop();
      const typedFile = new File([ab], justName, { type: mimeType });
      const ok = await saveBlob(typedFile, path);
      if (!ok) showWarning('blob');
      return;
    }

    if (isSupportedByArchive(currentArchiveFile.name) && archiveAPI) {
      const arch = await archiveAPI.open(currentArchiveFile);
      const map = await arch.extractFiles();
      const outFile = map[path];
      if (!outFile) return;
      const ab = await outFile.arrayBuffer();
      const mimeType = extMime(path);
      const justName = path.split('/').pop().split('\\').pop();
      const typedFile = new File([ab], justName, { type: mimeType });
      const ok = await saveBlob(typedFile, path);
      if (!ok) showWarning('blob');
      return;
    }
  }

  async function extractAll(file) {
    if (!downloadQueue.length) {
      alert('No files selected.'); return;
    }
    if (isZipName(file.name) && currentZipJS) {
      // JSZip: iterate and save with correct MIME types
      for (const path of downloadQueue) {
        const entry = currentZipJS.files[path];
        if (!entry || entry.dir) continue;
        // Use arraybuffer to get raw binary data
        const ab = await entry.async('arraybuffer');
        const mimeType = extMime(path);
        // Extract just the filename from the path
        const justName = path.split('/').pop().split('\\').pop();
        // Create a File object with explicit name and type (more reliable than Blob)
        const typedFile = new File([ab], justName, { type: mimeType });
        const ok = await saveBlob(typedFile, path);
        if (!ok) showWarning('multi');
      }
      return;
    }
    if (isSupportedByArchive(file.name) && archiveAPI) {
      const arch = await archiveAPI.open(file);
      const map = await arch.extractFiles(); // { name: File }
      for (const name of downloadQueue) {
        const outFile = map[name];
        if (!outFile) continue;
        // Re-create file with correct MIME type to prevent extension changes
        const ab = await outFile.arrayBuffer();
        const mimeType = extMime(name);
        const justName = name.split('/').pop().split('\\').pop();
        const typedFile = new File([ab], justName, { type: mimeType });
        const ok = await saveBlob(typedFile, name);
        if (!ok) showWarning('multi');
      }
      return;
    }
    alert('Open a supported archive first.');
  }
}

// ---------- Save helpers ----------
async function saveBlob(blobOrFile, filename) {
  try {
    // Extract just the filename (remove any path components)
    const safeName = filename.split('/').pop().split('\\').pop();

    // Debug: log file info
    console.log('[ZIPboost] Downloading:', {
      filename: safeName,
      blobType: blobOrFile.type,
      blobSize: blobOrFile.size,
      blobName: blobOrFile.name || 'N/A'
    });

    // Convert blob to ArrayBuffer and send to background script
    // This ensures the data is accessible from the service worker
    const arrayBuffer = await blobOrFile.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'downloadBlob',
        payload: {
          data: Array.from(uint8Array),
          filename: safeName,
          mimeType: blobOrFile.type || 'application/octet-stream'
        }
      });
      if (!resp?.ok) {
        // Fallback to anchor download
        console.warn('[ZIPboost] Background download failed, using anchor fallback');
        const url = URL.createObjectURL(blobOrFile);
        const a = document.createElement('a');
        a.href = url;
        a.download = safeName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(url), 8000);
      }
    } catch (downloadError) {
      console.error('[ZIPboost] Download error:', downloadError);
      // Last resort: direct anchor download
      const url = URL.createObjectURL(blobOrFile);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 8000);
    }
    return true;
  } catch (e) {
    console.warn('saveBlob failed', e);
    showWarning('multi'); return false;
  }
}

// ---------- Listen background warnings ----------
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'DOWNLOAD_INTERRUPTED') {
    showWarning('multi', `Reason: ${msg.reason||'unknown'}`);
  }
});
