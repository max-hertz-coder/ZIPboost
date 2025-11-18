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

// ---------- Helpers ----------
const fmt = (bytes) =>
  bytes < 1024 ? `${bytes} B` :
  bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` :
  bytes < 1073741824 ? `${(bytes/1048576).toFixed(1)} MB` :
  `${(bytes/1073741824).toFixed(1)} GB`;

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
    const level = 6; // balanced default compression
    const outName = (nameInput.value || 'archive.zip').replace(/[\/\\:*?"<>|]/g, '_');

    btn.disabled = true;
    $('#progress').textContent = 'Compressing...';

    try {
      const zip = new JSZip();
      filesToCompress.forEach(f => zip.file(f.name, f));
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level }
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
        return entry && !entry.dir;
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
      downloadQueue = currentArchiveEntries.filter((name) => !name.endsWith('/'));
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
          <button class="secondary xs file-remove" data-path="${path}" title="Remove">✕</button>
        </div>`;
      list.appendChild(row);
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

  async function extractAll(file) {
    if (!downloadQueue.length) {
      alert('No files selected.'); return;
    }
    if (isZipName(file.name) && currentZipJS) {
      // JSZip: iterate and save
      for (const path of downloadQueue) {
        const entry = currentZipJS.files[path];
        if (!entry || entry.dir) continue;
        const blob = await entry.async('blob');
        const ok = await saveBlob(blob, path);
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
        const ok = await saveBlob(outFile, name);
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
    const url = URL.createObjectURL(blobOrFile);
    const resp = await chrome.runtime.sendMessage({
      type: 'download',
      payload: { url, filename }
    });
    if (!resp?.ok) {
      // fallback
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      if (chrome.runtime.lastError || !resp) showWarning('blob');
    }
    setTimeout(()=>URL.revokeObjectURL(url), 8000);
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
