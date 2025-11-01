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

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  bindTabs();
  bindTheme();
  bindCompressUI();
  bindViewUI();
  maybeInitLibArchive(); // try to init libarchive if bundled
  $('#lib-status').textContent = archiveAPI ? 'libarchive: enabled' : 'libarchive: not found (ZIP only)';
});

// ---------- Tabs ----------
function bindTabs() {
  const tabCompress = $('#tab-compress');
  const tabView = $('#tab-view');
  const secCompress = $('#sec-compress');
  const secView = $('#sec-view');

  const activate = (name) => {
    if (name === 'compress') {
      tabCompress.classList.add('active'); tabView.classList.remove('active');
      secCompress.classList.add('active'); secView.classList.remove('active');
    } else {
      tabView.classList.add('active'); tabCompress.classList.remove('active');
      secView.classList.add('active'); secCompress.classList.remove('active');
    }
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
      icon.textContent = '🌞';
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
        <li>Try "Extract all" again after whitelisting.</li>
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
  const presetSel = $('#zip-preset');

  // DnD
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('drag-over');
    if (e.dataTransfer.files?.length) {
      filesToCompress = Array.from(e.dataTransfer.files);
      renderCompressList();
    }
  });
  dz.addEventListener('click', () => inp.click());
  inp.addEventListener('change', () => {
    if (inp.files?.length) {
      filesToCompress = Array.from(inp.files);
      renderCompressList();
    }
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
      btn.addEventListener('click', () => {
        const i = +btn.dataset.idx;
        filesToCompress.splice(i, 1);
        renderCompressList();
      });
    });
  }

  btn.addEventListener('click', async () => {
    if (!filesToCompress.length) {
      alert('No files selected.'); return;
    }
    const level = ({quick:1, optimal:6, maximum:9})[presetSel.value] ?? 6;
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

  $('#btn-clear-state').addEventListener('click', () => {
    list.innerHTML = ''; meta.textContent = ''; currentArchiveFile = null; currentZipJS = null;
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
    list.innerHTML = '';

    if (isZipName(file.name)) {
      // Use JSZip
      const ab = await file.arrayBuffer();
      currentZipJS = await JSZip.loadAsync(ab);
      renderZipEntriesJSZip(currentZipJS);
      return;
    }

    if (isSupportedByArchive(file.name)) {
      if (!archiveAPI) {
        showWarning('', 'Advanced formats require libarchive files. Please add libs/libarchive/* as described.');
        return;
      }
      const archive = await archiveAPI.open(file);
      const filesObj = await archive.getFilesObject(); // map: name -> CompressedFile
      renderArchiveEntries(filesObj);
      return;
    }

    alert('Unsupported format. Please open ZIP/RAR/7Z/TAR.');
  }

  function renderZipEntriesJSZip(zip) {
    list.innerHTML = '';
    Object.entries(zip.files).forEach(([path, entry]) => {
      if (entry.dir) return;
      const row = document.createElement('div');
      row.className = 'item file';
      row.innerHTML = `
        <div class="name">${path}</div>
        <div class="meta">${entry._data ? fmt(entry._data.uncompressedSize||0) : ''}</div>
        <div class="file-actions"><button class="xs" data-path="${path}">Open</button></div>`;
      list.appendChild(row);
    });
    $$('.file-actions .xs', list).forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = btn.dataset.path;
        const entry = currentZipJS.files[path];
        if (!entry) return;
        const ext = (path.split('.').pop()||'').toLowerCase();
        if (['txt','md','csv','json','js','css','log'].includes(ext)) {
          const text = await entry.async('string');
          const w = window.open('', '_blank');
          if (w) w.document.body.innerHTML = `<pre>${escapeHTML(text)}</pre>`;
        } else if (['png','jpg','jpeg','gif','bmp','webp','svg'].includes(ext)) {
          const blob = await entry.async('blob');
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank'); setTimeout(()=>URL.revokeObjectURL(url), 8000);
        } else {
          const blob = await entry.async('blob');
          await saveBlob(blob, path);
        }
      });
    });
  }

  function renderArchiveEntries(filesObj) {
    list.innerHTML = '';
    Object.keys(filesObj).forEach((name) => {
      const row = document.createElement('div');
      row.className = 'item file';
      row.innerHTML = `
        <div class="name">${name}</div>
        <div class="meta"></div>
        <div class="file-actions"><button class="xs" data-name="${name}">Open</button></div>`;
      list.appendChild(row);
    });

    $$('.file-actions .xs', list).forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        const cf = filesObj[name]; // CompressedFile
        try {
          const file = await cf.extract(); // returns File(Blob)
          await openOrSaveByType(file, name);
        } catch (e) {
          if (String(e).toLowerCase().includes('encrypted')) {
            const pwd = prompt('Archive is encrypted. Enter password:');
            if (pwd) {
              try {
                const arch = await archiveAPI.open(currentArchiveFile);
                arch.usePassword(pwd);
                const ff = await arch.extractFiles();
                const file2 = ff[name];
                await openOrSaveByType(file2, name);
              } catch (e2) { alert('Wrong password or cannot extract.'); }
            }
          } else {
            console.error(e); alert('Cannot open this file.');
          }
        }
      });
    });
  }

  async function extractAll(file) {
    if (isZipName(file.name) && currentZipJS) {
      // JSZip: iterate and save
      const entries = Object.entries(currentZipJS.files).filter(([,e]) => !e.dir);
      for (const [path, entry] of entries) {
        const blob = await entry.async('blob');
        const ok = await saveBlob(blob, path);
        if (!ok) showWarning('multi');
      }
      return;
    }
    if (isSupportedByArchive(file.name) && archiveAPI) {
      const arch = await archiveAPI.open(file);
      const map = await arch.extractFiles(); // { name: File }
      for (const [name, outFile] of Object.entries(map)) {
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

function escapeHTML(s) {
  const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'};
  return String(s).replace(/[&<>"']/g, ch => map[ch]);
}

// ---------- Listen background warnings ----------
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'DOWNLOAD_INTERRUPTED') {
    showWarning('multi', `Reason: ${msg.reason||'unknown'}`);
  }
});
