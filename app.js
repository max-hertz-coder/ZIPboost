// ======================= ZIPboost (MV3 Popup Script) =======================
// Drag & Drop для обеих вкладок, сжатие, просмотр/извлечение ZIP,
// восстановление состояния через chrome.storage.local.

// ---------- Helpers ----------
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

const fmt = (bytes) =>
  bytes < 1024 ? `${bytes} B` :
  bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` :
  bytes < 1073741824 ? `${(bytes/1048576).toFixed(1)} MB` :
  `${(bytes/1073741824).toFixed(1)} GB`;

const sanitizeName = (s) => (s || "archive.zip").replace(/[\/\\:*?"<>|]/g, "_");

// Filter out macOS metadata files (__MACOSX folders and ._ resource fork files)
const isMacOSMetadata = (path) => {
  const name = path.split('/').pop() || path;
  return path.startsWith('__MACOSX/') || path.includes('/__MACOSX/') || name.startsWith('._');
};

const extMime = (name) => {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const m = {
    // Images
    png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif",
    webp:"image/webp", svg:"image/svg+xml", bmp:"image/bmp", ico:"image/x-icon",
    tiff:"image/tiff", tif:"image/tiff", heic:"image/heic", heif:"image/heif",

    // Documents
    pdf:"application/pdf", doc:"application/msword",
    docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls:"application/vnd.ms-excel",
    xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt:"application/vnd.ms-powerpoint",
    pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt:"application/vnd.oasis.opendocument.text",
    ods:"application/vnd.oasis.opendocument.spreadsheet",
    odp:"application/vnd.oasis.opendocument.presentation",

    // Text
    txt:"text/plain", md:"text/markdown", rtf:"application/rtf",
    html:"text/html", htm:"text/html", xml:"text/xml",
    css:"text/css", js:"text/javascript", json:"application/json",
    csv:"text/csv", log:"text/plain", ini:"text/plain",

    // Archives
    zip:"application/zip", rar:"application/x-rar-compressed",
    "7z":"application/x-7z-compressed", tar:"application/x-tar",
    gz:"application/gzip", bz2:"application/x-bzip2", xz:"application/x-xz",

    // Audio
    mp3:"audio/mpeg", wav:"audio/wav", ogg:"audio/ogg", m4a:"audio/mp4",
    flac:"audio/flac", aac:"audio/aac", wma:"audio/x-ms-wma",

    // Video
    mp4:"video/mp4", avi:"video/x-msvideo", mov:"video/quicktime",
    wmv:"video/x-ms-wmv", flv:"video/x-flv", mkv:"video/x-matroska",
    webm:"video/webm", m4v:"video/x-m4v", mpeg:"video/mpeg", mpg:"video/mpeg",

    // Programming
    py:"text/x-python", java:"text/x-java", cpp:"text/x-c++src", c:"text/x-csrc",
    h:"text/x-chdr", hpp:"text/x-c++hdr", cs:"text/x-csharp", php:"text/x-php",
    rb:"text/x-ruby", go:"text/x-go", rs:"text/x-rust", swift:"text/x-swift",
    kt:"text/x-kotlin", ts:"text/typescript", tsx:"text/tsx", jsx:"text/jsx",

    // Executables & System
    exe:"application/x-msdownload", dll:"application/x-msdownload",
    dmg:"application/x-apple-diskimage", app:"application/x-apple-app",
    deb:"application/x-debian-package", rpm:"application/x-rpm",
    bat:"application/bat", sh:"application/x-sh", ps1:"application/x-powershell",

    // Fonts
    ttf:"font/ttf", otf:"font/otf", woff:"font/woff", woff2:"font/woff2",

    // Other
    apk:"application/vnd.android.package-archive",
    iso:"application/x-iso9660-image",
    sqlite:"application/x-sqlite3", db:"application/x-sqlite3"
  };
  return m[ext] || "application/octet-stream";
};

const storageGet = (keys) => new Promise(r => chrome.storage.local.get(keys, r));
const storageSet = (obj)  => new Promise(r => chrome.storage.local.set(obj, r));

// ---------- Shared state ----------
let JSZIP_OK = false;

// ---------- Persist / Restore ----------
async function saveStateFull(statePatch = {}) {
  const cur = (await storageGet(["zipboost_state"])).zipboost_state || {};
  const next = { ...cur, ...statePatch };

  if (next.currentZipBlob instanceof Blob) {
    const ab = await next.currentZipBlob.arrayBuffer();
    next.currentZipData = Array.from(new Uint8Array(ab));
    delete next.currentZipBlob;
  }
  await storageSet({ zipboost_state: next });
  return next;
}

async function loadStateFull() {
  const res = (await storageGet(["zipboost_state"])).zipboost_state || null;
  if (res && res.currentZipData) {
    const u8 = new Uint8Array(res.currentZipData);
    res.currentZipBlob = new Blob([u8], { type: "application/zip" });
    delete res.currentZipData;
  }
  return res;
}

async function clearState() {
  await storageSet({ zipboost_state: null });
}

// ---------- View helpers ----------
function ensureButton(button) {
  if (button && button.tagName === "BUTTON" && !button.getAttribute("type")) {
    button.setAttribute("type", "button");
  }
}

// ============================================================================
//                               UI ELEMENTS
// ============================================================================
const tabC = $("#tab-compress");
const tabV = $("#tab-view");

const secC = $("#sec-compress");
const secV = $("#sec-view");

// Compress
const dzC   = $("#dz-compress");
const inC   = $("#inp-compress");
const listC = $("#list-compress");
const zipName = $("#zip-name");
const btnZip  = $("#btn-compress");
const progC   = $("#progress");

// View
const dzV   = $("#dz-view");
const inV   = $("#inp-zip");
const listV = $("#list-zip");
const metaV = $("#zip-meta");
const btnExtract = $("#btn-extract-all");
const btnReopen  = $("#btn-reopen-zip");
const btnClear   = $("#btn-clear-state");

// Local runtime buffers
let files = [];                // для Compress
let currentZip = null;         // для View
let currentZipName = "archive.zip";

// ===================== Merge & de-dup for Compress ==========================
const fileKey = (f) => `${f.name}::${f.size}::${f.lastModified||0}`;

function addFiles(newList) {
  const map = new Map(files.map(f => [fileKey(f), f]));
  for (const f of newList) map.set(fileKey(f), f);
  files = Array.from(map.values());
}

// ============================================================================
//                            PLATFORM / PICKER HELPERS
// ============================================================================

async function getOS() {
  try {
    const info = await new Promise(res => chrome.runtime.getPlatformInfo(res));
    return info?.os || 'unknown';
  } catch { return 'unknown'; }
}

async function pickFilesWithSystemDialog(opts = { multiple: true, accept: [] }) {
  // 1) Пробуем современный File System Access API — обычно не закрывает поп-ап
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: !!opts.multiple,
        types: opts.accept?.length ? [{ description: 'Files', accept: opts.accept }] : undefined
      });
      const files = await Promise.all(handles.map(h => h.getFile()));
      return files;
    } catch (e) {
      // пользователь мог отменить; пробуем дальше
    }
  }
  // 2) Фолбэк: обычный <input type=file> (может закрыть поп-ап на Linux)
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !!opts.multiple;
    if (opts.acceptExts) input.accept = opts.acceptExts;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const chosen = Array.from(input.files || []);
      document.body.removeChild(input);
      resolve(chosen);
    }, { once: true });
    input.click();
  });
}

async function robustOpenPickerInPopup(kind /* 'compress' | 'view' */) {
  const isCompress = kind === 'compress';

  // Какие типы ожидаем
  const accept = isCompress
    ? { accept: [] } // любые файлы
    : { accept: [{ 'application/zip': ['.zip'], 'application/x-rar-compressed':['.rar'], 'application/x-7z-compressed':['.7z'], 'application/x-tar':['.tar','.tgz','.tar.gz'] }] };

  const os = await getOS();

  // ШАГ A: сначала пробуем File System Access API (обычно безопасно)
  try {
    const files = await pickFilesWithSystemDialog({
      multiple: isCompress,
      accept: accept.accept,
      acceptExts: isCompress ? '' : '.zip,.rar,.7z,.tar,.tar.gz,.tgz'
    });
    if (files && files.length) {
      if (isCompress) {
        addFiles(files);
        renderCompressList();
        await persistCompressState();
      } else {
        const f = files[0];
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        if (ext !== 'zip') {
          // для .rar/.7z/.tar — сразу сохраняем
          const url = URL.createObjectURL(f);
          chrome.downloads.download(
            { url, filename: f.name, conflictAction: 'uniquify', saveAs: false },
            () => setTimeout(() => URL.revokeObjectURL(url), 3000)
          );
        } else {
          openZip(f);
        }
      }
      return; // успех, поп-ап не закрыли
    }
  } catch (_) {}

  // ШАГ B: если платформа проблемная (Linux) — открываем вкладку «Full View» и автозапускаем выбор там
  if (os === 'linux') {
    const hash = isCompress ? '#compress&autopick=1' : '#view&autopick=1';
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html' + hash) });
    // закрываем текущий поп-ап — теперь работа продолжится во вкладке (она не закрывается)
    window.close();
    return;
  }

  // ШАГ C: в других случаях — пробуем ещё раз обычный input (на большинстве систем поп-ап остаётся)
  const fallback = await pickFilesWithSystemDialog({
    multiple: isCompress,
    accept: accept.accept,
    acceptExts: isCompress ? '' : '.zip,.rar,.7z,.tar,.tar.gz,.tgz'
  });
  if (fallback && fallback.length) {
    if (isCompress) {
      addFiles(fallback);
      renderCompressList();
      await persistCompressState();
    } else {
      const f = fallback[0];
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (ext !== 'zip') {
        const url = URL.createObjectURL(f);
        chrome.downloads.download(
          { url, filename: f.name, conflictAction: 'uniquify', saveAs: false },
          () => setTimeout(() => URL.revokeObjectURL(url), 3000)
        );
      } else {
        openZip(f);
      }
    }
  }
}

// ============================================================================
//                               INIT
// ============================================================================
(function checkJSZip() {
  try {
    JSZIP_OK = typeof JSZip === "function" && typeof (new JSZip()).generateAsync === "function";
  } catch { JSZIP_OK = false; }
  const libStatus = $("#lib-status");
  if (!JSZIP_OK && libStatus) {
    libStatus.textContent = "JSZip not found. Make sure libs/jszip.min.js is included.";
  }
})();

async function activate(section, tabBtn) {
  [secC, secV].forEach(s => s.classList.remove("active"));
  [tabC, tabV].forEach(t => t.classList.remove("active"));
  section.classList.add("active");
  tabBtn.classList.add("active");
  await saveStateFull({ activeTab: section === secC ? "compress" : "view" });
}

on(tabC, "click", () => activate(secC, tabC));
on(tabV, "click", () => activate(secV, tabV));

// Восстановление «умолчаний»
(async () => {
  const { lastZipName } = await storageGet(["lastZipName"]);
  zipName.value = lastZipName && !/\.tar$/i.test(lastZipName) ? lastZipName : "archive.zip";
})();

// Восстановление состояния обеих вкладок + автозапуск выбора в режиме Full View
(async () => {
  const state = await loadStateFull();
  const hash = (location.hash || "").toLowerCase();

  const wantView = hash.includes("view");
  const wantCompress = hash.includes("compress");

  // если пришли во вкладку с автоподбором файлов
  const autoPick = hash.includes("autopick=1");

  if (state?.activeTab === "view" || wantView) {
    await activate(secV, tabV);
    if (autoPick) {
      // откроем выбор архива во вкладке (здесь поп-апа уже нет)
      robustOpenPickerInPopup('view');
      return;
    }
    if (state?.currentZipBlob && state.currentZipName && state.entries) {
      try {
        currentZip = await JSZip.loadAsync(await state.currentZipBlob.arrayBuffer());
        currentZipName = state.currentZipName;
        const filteredEntries = Object.keys(currentZip.files).filter(path => !isMacOSMetadata(path));
        renderZipEntries(filteredEntries);
        metaV.textContent = `${filteredEntries.length} entries in ${state.currentZipName}`;
        btnReopen.style.display = "none";
        btnExtract.style.display = "inline-block";
      } catch {
        renderZipNeedsReopen(state);
      }
    } else if (state?.currentZipName && state.entries) {
      renderZipNeedsReopen(state);
    }
  } else {
    await activate(secC, tabC);
    if (autoPick) {
      robustOpenPickerInPopup('compress');
      return;
    }
    if (state?.compressFiles?.length) {
      try {
        files = state.compressFiles.map(f => new File([new Uint8Array(f.data)], f.name, { type: f.type }));
      } catch { files = []; }
      renderCompressList();
    }
    if (state?.zipName) zipName.value = state.zipName;
  }
})();

// ============================================================================
//                             COMPRESS TAB
// ============================================================================
function renderCompressList() {
  if (!files.length) {
    listC.innerHTML = `<div class="meta" style="padding:10px">No files selected.</div>`;
    return;
  }
  listC.innerHTML = files.map((f, i) => `
    <div class="item">
      <div class="name" title="${f.name}">${f.name}</div>
      <div class="meta">${fmt(f.size)}</div>
      <button class="secondary xs item-remove" data-i="${i}" title="Remove" type="button">✕</button>
    </div>
  `).join("");

  $$(".item-remove", listC).forEach(btn => {
    ensureButton(btn);
    on(btn, "click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(btn.dataset.i);
      if (!Number.isNaN(idx)) {
        files.splice(idx, 1);
        renderCompressList();
        await persistCompressState();
      }
    });
  });
}

async function persistCompressState() {
  const pack = [];
  for (const f of files) {
    const ab = await f.arrayBuffer();
    pack.push({ name: f.name, type: f.type, data: Array.from(new Uint8Array(ab)) });
  }
  await saveStateFull({
    activeTab: "compress",
    zipName: zipName.value,
    compressFiles: pack
  });
}

// drag visuals
["dragenter","dragover"].forEach(ev => on(dzC, ev, e => {
  e.preventDefault(); e.stopPropagation(); dzC.classList.add("drag");
}));
["dragleave","drop"].forEach(ev => on(dzC, ev, e => {
  e.preventDefault(); e.stopPropagation(); dzC.classList.remove("drag");
}));

// drop files or URL (link/image) -> add to list
on(dzC, "drop", async (e) => {
  const dt = e.dataTransfer;
  if (!dt) return;
  if (dt.files?.length) {
    addFiles(Array.from(dt.files));
    renderCompressList();
    await persistCompressState();
    return;
  }
  const url = dt.getData("text/uri-list") || dt.getData("URL") || dt.getData("text/plain");
  if (url) {
    try {
      const resp = await new Promise(res => chrome.runtime.sendMessage({ type: "FETCH_URL", url }, res));
      if (!resp?.ok) throw new Error(resp?.error || "Fetch error");
      const u8 = new Uint8Array(resp.buffer);
      const blob = new Blob([u8], { type: resp.mime || "application/octet-stream" });
      const file = new File([blob], resp.name || "file", { type: blob.type });
      addFiles([file]);
      renderCompressList();
      await persistCompressState();
    } catch (err) {
      console.warn("Failed to add URL:", err);
      alert("Failed to fetch dropped URL.");
    }
  }
});

// open file dialog from zone (устойчиво к закрытию поп-апа)
on(dzC, "click", (e) => { e.preventDefault(); robustOpenPickerInPopup('compress'); });

// input change (подхватываем, если он был вставлен скриптом-подпоркой)
on(inC, "change", async () => {
  const chosen = Array.from(inC.files || []);
  if (chosen.length) {
    addFiles(chosen);
    renderCompressList();
    await persistCompressState();
  }
  inC.value = "";
});

// compress -> zip -> download
ensureButton(btnZip);
on(btnZip, "click", async (e) => {
  e.preventDefault(); e.stopPropagation();
  if (!JSZIP_OK) return alert("JSZip is not loaded.");
  if (!files.length) return alert("Add files first.");

  await storageSet({ lastZipName: zipName.value });

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

  const name  = sanitizeName(zipName.value || "archive.zip");

  btnZip.disabled = true;
  progC.textContent = "Packing…";
  try {
    const zip = new JSZip();
    // Add files with appropriate compression
    for (const f of files) {
      if (isPreCompressed(f.name)) {
        // STORE = no compression for already-compressed files
        zip.file(f.name, f, { compression: "STORE" });
      } else {
        // Level 1 = fastest DEFLATE compression
        zip.file(f.name, f, { compression: "DEFLATE", compressionOptions: { level: 1 } });
      }
    }

    const blob = await zip.generateAsync(
      { type: "blob", streamFiles: true },
      (m) => { if (m?.percent != null) progC.textContent = `Packing… ${Math.round(m.percent)}%`; }
    );

    const url = URL.createObjectURL(blob);

    chrome.downloads.download(
      { url, filename: name, conflictAction: "uniquify", saveAs: false },
      (id) => {
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        if (chrome.runtime.lastError) {
          console.error("download error:", chrome.runtime.lastError.message);
          alert("Chrome prevented the download. Check chrome://settings/downloads and allow downloads for extensions.");
        } else {
          progC.textContent = "ZIP saved to Downloads.";
        }
      }
    );
  } catch (err) {
    console.error("Compression error:", err);
    alert("Compression failed: " + err.message);
  } finally {
    btnZip.disabled = false;
  }
});

// Сохраняем периодически
setInterval(() => { if (secC.classList.contains("active")) persistCompressState(); }, 4000);

// ============================================================================
//                               VIEW TAB
// ============================================================================
function renderZipEntries(entries) {
  listV.innerHTML = entries.map(path => {
    const entry = currentZip.files[path];
    const label = entry.dir ? `[Folder] ${path}` : path;
    let right = "";
    if (!entry.dir) {
      let size = 0;
      if (entry._data && entry._data.uncompressedSize) size = entry._data.uncompressedSize;
      else if (entry.uncompressedSize)                  size = entry.uncompressedSize;
      right = size > 0 ? fmt(size) : "";
    } else {
      right = "—";
    }
    const buttons = entry.dir ? "" : `
      <div class="file-actions">
        <button class="secondary xs file-open" data-path="${path}" title="Open in browser" type="button">Open</button>
        <button class="secondary xs file-dl"   data-path="${path}" title="Download file" type="button">Download</button>
      </div>`;
    return `<div class="item file" data-path="${path}">
      <div class="name" title="${path}">${label}</div>
      <div class="meta">${right}</div>
      ${buttons}
    </div>`;
  }).join("");

  // open
  $$(".file-open", listV).forEach(btn => {
    ensureButton(btn);
    on(btn, "click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const path = btn.dataset.path;
      const entry = currentZip.file(path);
      if (!entry) return;
      try {
        const ab = await entry.async("arraybuffer");
        const mime = extMime(path);
        const ext = (path.split(".").pop() || "").toLowerCase();

        const textExts = ['txt','md','csv','json','js','css','html','htm','xml','log','ini','bat','sh','ps1','py','java','cpp','c','h','php','rb','go','rs','ts','tsx','jsx','yaml','yml','toml','cfg','conf'];
        if (textExts.includes(ext) || mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || mime === "text/xml") {
          const text = new TextDecoder().decode(new Uint8Array(ab));
          const w = window.open("", "_blank");
          if (w) {
            const esc = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
            w.document.write(`
              <!DOCTYPE html><html><head><meta charset="utf-8"><title>${path}</title>
              <style>body{font-family:monospace;padding:20px;background:#fff;color:#000;line-height:1.6}
              @media (prefers-color-scheme:dark){body{background:#1e1e1e;color:#d4d4d4}} pre{white-space:pre-wrap;margin:0}</style>
              </head><body><pre>${esc}</pre></body></html>`);
            w.document.close();
          }
          return;
        }

        if (mime.startsWith("image/") || mime === "application/pdf" || mime.startsWith("application/vnd.")) {
          const blob = new Blob([ab], { type: mime });
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          return;
        }

        const typedBlob = new Blob([ab], { type: mime });
        const url = URL.createObjectURL(typedBlob);
        // Ensure proper filename formatting and preserve extension
        let safePath = path.replace(/^\/+/, "").replace(/\\/g, "/");
        chrome.downloads.download(
          { url, filename: safePath, conflictAction: "uniquify", saveAs: false },
          () => setTimeout(() => URL.revokeObjectURL(url), 3000)
        );
      } catch (err) {
        console.error("open error:", err);
        alert("Failed to open file: " + err.message);
      }
    });
  });

  // download
  $$(".file-dl", listV).forEach(btn => {
    ensureButton(btn);
    on(btn, "click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const path = btn.dataset.path;
      const entry = currentZip.file(path);
      if (!entry) return;
      try {
        // Get the proper MIME type for this file
        const mimeType = extMime(path);
        // Use arraybuffer to get raw binary data, then create blob with correct MIME type
        const ab = await entry.async("arraybuffer");
        const typedBlob = new Blob([ab], { type: mimeType });
        const url = URL.createObjectURL(typedBlob);
        const safePath = path.replace(/^\/+/, "").replace(/\\/g, "/");
        chrome.downloads.download(
          { url, filename: safePath, conflictAction: "uniquify", saveAs: false },
          () => setTimeout(() => URL.revokeObjectURL(url), 3000)
        );
      } catch (err) {
        console.error("download error:", err);
        alert("Failed to download file: " + err.message);
      }
    });
  });
}

function renderZipNeedsReopen(state) {
  const filteredEntries = (state.entries || []).filter(path => !isMacOSMetadata(path));
  metaV.textContent = `Previously viewed: ${state.currentZipName} (${filteredEntries.length} entries)`;
  btnReopen.style.display = "inline-block";
  btnExtract.style.display = "none";
  listV.innerHTML = `
    <div class="meta reopen-message">
      <strong>📁 ZIP needs to be reopened</strong><br>
      Click "Reopen ZIP" or drop "${state.currentZipName}" again.
    </div>
    ${filteredEntries.map(p => `<div class="item file reopen-item"><div class="name">${p}</div><div class="meta">reopen</div></div>`).join("")}
  `;
  $$(".item.file", listV).forEach(el => on(el, "click", () => robustOpenPickerInPopup('view')));
}

// drag visuals for VIEW
["dragenter","dragover"].forEach(ev => on(dzV, ev, e => {
  e.preventDefault(); e.stopPropagation(); dzV.classList.add("drag");
}));
["dragleave","drop"].forEach(ev => on(dzV, ev, e => {
  e.preventDefault(); e.stopPropagation(); dzV.classList.remove("drag");
}));

// drop archive on VIEW
on(dzV, "drop", async (e) => {
  const dt = e.dataTransfer;
  if (!dt?.files?.length) return;
  const file = dt.files[0];
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!["zip","rar","7z","tar","tgz"].includes(ext)) {
    alert("Please drop a supported archive: .zip, .rar, .7z, .tar");
    return;
  }
  if (ext !== "zip") {
    alert(`.${ext} is not supported for inline viewing. The file will be saved.`);
    const url = URL.createObjectURL(file);
    chrome.downloads.download({ url, filename: file.name, conflictAction: "uniquify", saveAs: false },
      () => setTimeout(() => URL.revokeObjectURL(url), 3000));
    return;
  }
  openZip(file);
});

// click zone -> устойчивый выбор архива
on(dzV, "click", (e) => { e.preventDefault(); robustOpenPickerInPopup('view'); });

// input change (если использовали скрытый input)
on(inV, "change", () => {
  const f = inV.files?.[0];
  if (f) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (ext !== "zip") {
      const url = URL.createObjectURL(f);
      chrome.downloads.download({ url, filename: f.name, conflictAction: "uniquify", saveAs: false },
        () => setTimeout(() => URL.revokeObjectURL(url), 3000));
    } else {
      openZip(f);
    }
  }
  inV.value = "";
});

// open ZIP with JSZip & render
async function openZip(file) {
  if (!JSZIP_OK) return alert("JSZip is not loaded.");
  try {
    metaV.textContent = `Loading ${file.name}…`;
    currentZip = await JSZip.loadAsync(await file.arrayBuffer());
    currentZipName = file.name;

    const allEntries = Object.keys(currentZip.files).sort();
    const entries = allEntries.filter(path => !isMacOSMetadata(path));
    renderZipEntries(entries);
    metaV.textContent = `${entries.length} entries in ${file.name}`;
    btnReopen.style.display = "none";
    btnExtract.style.display = "inline-block";

    await saveStateFull({
      activeTab: "view",
      currentZipName: file.name,
      entries,
      currentZipBlob: file
    });

    await activate(secV, tabV);
  } catch (err) {
    console.error("ZIP open error:", err);
    alert("Unable to read ZIP (maybe corrupted or invalid).");
  }
}

// Extract all files
ensureButton(btnExtract);
on(btnExtract, "click", async (e) => {
  e.preventDefault(); e.stopPropagation();
  if (!currentZip) return alert("Open a ZIP first.");
  const base = currentZipName.replace(/\.zip$/i, "");
  let count = 0;

  for (const [name, entry] of Object.entries(currentZip.files)) {
    if (entry.dir) continue;
    if (isMacOSMetadata(name)) continue; // Skip macOS metadata files
    try {
      // Get the proper MIME type for this file
      const mimeType = extMime(name);
      // Use arraybuffer to get raw binary data, then create blob with correct MIME type
      const ab = await entry.async("arraybuffer");
      const typedBlob = new Blob([ab], { type: mimeType });
      const url = URL.createObjectURL(typedBlob);

      // Preserve original file path and extension
      const safePath = name.replace(/\\/g, "/").replace(/^\/+/, "");

      chrome.downloads.download(
        { url, filename: `${base}/${safePath}`, conflictAction: "uniquify", saveAs: false },
        () => setTimeout(() => URL.revokeObjectURL(url), 3000)
      );
      count++;
    } catch (err) {
      console.warn("Extract failed:", name, err);
    }
  }
  metaV.textContent = `Extracted ${count} file(s) to Downloads/${base}/`;
});

// Reopen
ensureButton(btnReopen);
on(btnReopen, "click", (e) => { e.preventDefault(); e.stopPropagation(); robustOpenPickerInPopup('view'); });

// Clear (не переключаем вкладку!)
ensureButton(btnClear);
on(btnClear, "click", async (e) => {
  e.preventDefault(); e.stopPropagation();
  await saveStateFull({
    activeTab: "view",
    currentZipName: null,
    entries: [],
    currentZipBlob: null,
    currentZipData: null
  });
  currentZip = null;
  currentZipName = "archive.zip";
  listV.innerHTML = "";
  metaV.textContent = "";
  btnReopen.style.display = "none";
  btnExtract.style.display = "inline-block";
});

// ============================================================================
//                     Guard: prevent "click-through" inside popup
// ============================================================================
['mousedown','mouseup','click'].forEach(ev =>
  document.addEventListener(ev, e => e.stopPropagation(), true)
);
