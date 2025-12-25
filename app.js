// ======================= ZIPboost (MV3 Popup Script) =======================
// Drag & Drop для обеих вкладок, сжатие, просмотр/извлечение ZIP,
// восстановление состояния через chrome.storage.local.

// ---------- Helpers ----------
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const on = (el, ev, fn, opts) => el.addEventListener(ev, fn, opts);

const fmt = (bytes) =>
  bytes < 1024 ? `${bytes} B` :
  bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` :
  bytes < 1073741824 ? `${(bytes/1048576).toFixed(1)} MB` :
  `${(bytes/1073741824).toFixed(1)} GB`;

const sanitizeName = (s) => (s || "archive.zip").replace(/[\/\\:*?"<>|]/g, "_");

const extMime = (name) => {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const m = {
    // images
    png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif",
    webp:"image/webp", svg:"image/svg+xml", bmp:"image/bmp", ico:"image/x-icon",
    tiff:"image/tiff", tif:"image/tiff", heic:"image/heic", heif:"image/heif",
    // docs
    pdf:"application/pdf", doc:"application/msword",
    docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls:"application/vnd.ms-excel",
    xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt:"application/vnd.ms-powerpoint",
    pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt:"application/vnd.oasis.opendocument.text",
    ods:"application/vnd.oasis.opendocument.spreadsheet",
    odp:"application/vnd.oasis.opendocument.presentation",
    // text/code
    txt:"text/plain", md:"text/markdown", rtf:"application/rtf",
    html:"text/html", htm:"text/html", xml:"text/xml",
    css:"text/css", js:"text/javascript", mjs:"text/javascript",
    json:"application/json", csv:"text/csv", tsv:"text/tab-separated-values",
    log:"text/plain", ini:"text/plain", cfg:"text/plain", conf:"text/plain",
    // programming languages
    ts:"text/typescript", tsx:"text/typescript", jsx:"text/javascript",
    py:"text/x-python", rb:"text/x-ruby", java:"text/x-java",
    c:"text/x-c", cpp:"text/x-c++", cc:"text/x-c++", cxx:"text/x-c++",
    h:"text/x-c", hpp:"text/x-c++", cs:"text/x-csharp",
    php:"text/x-php", go:"text/x-go", rs:"text/x-rust",
    swift:"text/x-swift", kt:"text/x-kotlin", scala:"text/x-scala",
    sql:"text/x-sql", pl:"text/x-perl", sh:"text/x-shellscript",
    bash:"text/x-shellscript", zsh:"text/x-shellscript",
    ps1:"text/plain", bat:"text/plain", cmd:"text/plain",
    // config/data formats
    yaml:"text/yaml", yml:"text/yaml", toml:"text/toml",
    // archives
    zip:"application/zip", rar:"application/x-rar-compressed",
    "7z":"application/x-7z-compressed", tar:"application/x-tar",
    gz:"application/gzip", gzip:"application/gzip", bz2:"application/x-bzip2",
    xz:"application/x-xz", tgz:"application/x-tar", tbz2:"application/x-tar",
    // audio
    mp3:"audio/mpeg", wav:"audio/wav", ogg:"audio/ogg", m4a:"audio/mp4",
    flac:"audio/flac", aac:"audio/aac", wma:"audio/x-ms-wma",
    opus:"audio/opus", webm:"audio/webm",
    // video
    mp4:"video/mp4", avi:"video/x-msvideo", mov:"video/quicktime",
    wmv:"video/x-ms-wmv", flv:"video/x-flv", mkv:"video/x-matroska",
    webm:"video/webm", m4v:"video/x-m4v", mpg:"video/mpeg", mpeg:"video/mpeg",
    "3gp":"video/3gpp", ogv:"video/ogg",
    // fonts
    ttf:"font/ttf", otf:"font/otf", woff:"font/woff", woff2:"font/woff2",
    eot:"application/vnd.ms-fontobject",
    // other common types
    exe:"application/x-msdownload", dll:"application/x-msdownload",
    msi:"application/x-msi", dmg:"application/x-apple-diskimage",
    apk:"application/vnd.android.package-archive",
    iso:"application/x-iso9660-image",
    torrent:"application/x-bittorrent"
  };
  return m[ext] || "application/octet-stream";
};

const canOpenInBrowser = (mime) => {
  const allow = [
    "image/", "text/", "application/pdf", "application/json",
    "application/xml", "text/xml", "application/javascript", "text/javascript"
  ];
  return allow.some(p => mime.startsWith(p));
};

const storageGet = (keys) => new Promise(r => chrome.storage.local.get(keys, r));
const storageSet = (obj)  => new Promise(r => chrome.storage.local.set(obj, r));

// ---------- Shared state ----------
let JSZIP_OK = false;

// ---------- Persist / Restore ----------
async function saveStateFull(statePatch = {}) {
  // читаем текущее
  const cur = (await storageGet(["zipboost_state"])).zipboost_state || {};
  const next = { ...cur, ...statePatch };

  // если есть Blob, сериализуем
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
const preset  = $("#zip-preset");
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

// Восстановление «умолчаний» (имя архива/пресет)
(async () => {
  const { lastZipName, lastPreset } = await storageGet(["lastZipName", "lastPreset"]);
  zipName.value = lastZipName && !/\.tar$/i.test(lastZipName) ? lastZipName : "archive.zip";
  preset.value = lastPreset || "optimal";
})();

// Восстановление состояния обеих вкладок
(async () => {
  const state = await loadStateFull();
  const wantView = (location.hash || "").toLowerCase().includes("view");

  if (state?.activeTab === "view" || wantView) {
    await activate(secV, tabV);
    // попытаться полностью восстановить ZIP
    if (state?.currentZipBlob && state.currentZipName && state.entries) {
      try {
        currentZip = await JSZip.loadAsync(await state.currentZipBlob.arrayBuffer());
        currentZipName = state.currentZipName;
        renderZipEntries(Object.keys(currentZip.files));
        metaV.textContent = `${state.entries.length} entries in ${state.currentZipName}`;
        btnReopen.style.display = "none";
        btnExtract.style.display = "inline-block";
      } catch {
        // не получилось — показываем просьбу переоткрыть
        renderZipNeedsReopen(state);
      }
    } else if (state?.currentZipName && state.entries) {
      renderZipNeedsReopen(state);
    }
  } else {
    await activate(secC, tabC);
    // восстановить список файлов Compress (если был)
    if (state?.compressFiles?.length) {
      try {
        files = state.compressFiles.map(f => new File([new Uint8Array(f.data)], f.name, { type: f.type }));
      } catch { files = []; }
      renderCompressList();
    }
    if (state?.zipName) zipName.value = state.zipName;
    if (state?.preset)  preset.value  = state.preset;
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

  // Удаление (только одного) файла
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

// сохранить текущее состояние Compress
async function persistCompressState() {
  const pack = [];
  for (const f of files) {
    const ab = await f.arrayBuffer();
    pack.push({ name: f.name, type: f.type, data: Array.from(new Uint8Array(ab)) });
  }
  await saveStateFull({
    activeTab: "compress",
    zipName: zipName.value,
    preset: preset.value,
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
    files.push(...Array.from(dt.files));
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
      files.push(file);
      renderCompressList();
      await persistCompressState();
    } catch (err) {
      console.warn("Failed to add URL:", err);
      alert("Failed to fetch dropped URL.");
    }
  }
});

// open file dialog from zone
on(dzC, "click", (e) => { e.preventDefault(); inC.click(); });

// input change
on(inC, "change", async () => {
  const chosen = Array.from(inC.files || []);
  if (chosen.length) {
    files = chosen;
    renderCompressList();
    await persistCompressState();
  }
  inC.value = "";
});

// compress -> zip -> download (download directly from popup!)
ensureButton(btnZip);
on(btnZip, "click", async (e) => {
  e.preventDefault(); e.stopPropagation();
  if (!JSZIP_OK) return alert("JSZip is not loaded.");
  if (!files.length) return alert("Add files first.");

  // запомним настройки
  await storageSet({ lastZipName: zipName.value, lastPreset: preset.value });

  const level = preset.value === "quick" ? 1 : (preset.value === "maximum" ? 9 : 6);
  const name  = sanitizeName(zipName.value || "archive.zip");

  btnZip.disabled = true;
  progC.textContent = "Packing…";
  try {
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f);

    const blob = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level }, streamFiles: true },
      (m) => { if (m?.percent != null) progC.textContent = `Packing… ${Math.round(m.percent)}%`; }
    );

    const url = URL.createObjectURL(blob);

    // ВАЖНО: скачиваем прямо из popup (не через background),
    // потому что blob: URL из popup недоступен в service worker контексте.
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

// Сохранять состояние периодически, чтобы не потерять, если пользователь кликнул вне попапа
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
      // Пытаемся получить размер файла разными способами
      let size = 0;
      if (entry._data && entry._data.uncompressedSize) {
        size = entry._data.uncompressedSize;
      } else if (entry.uncompressedSize) {
        size = entry.uncompressedSize;
      }
      right = size > 0 ? fmt(size) : "";
    } else if (entry.dir) {
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

  // bind open/download
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
        
        // Текстовые файлы - создаем HTML страницу с содержимым
        const textExts = ['txt', 'md', 'csv', 'json', 'js', 'css', 'html', 'htm', 'xml', 'log', 'ini', 'bat', 'sh', 'ps1', 'py', 'java', 'cpp', 'c', 'h', 'php', 'rb', 'go', 'rs', 'ts', 'tsx', 'jsx', 'yaml', 'yml', 'toml', 'cfg', 'conf'];
        if (textExts.includes(ext) || mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || mime === "text/xml") {
          const text = await entry.async("string");
          const w = window.open("", "_blank");
          if (w) {
            const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
            w.document.write(`
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <title>${path}</title>
                <style>
                  body { font-family: monospace; padding: 20px; background: #fff; color: #000; line-height: 1.6; }
                  @media (prefers-color-scheme: dark) { body { background: #1e1e1e; color: #d4d4d4; } }
                  pre { white-space: pre-wrap; word-wrap: break-word; margin: 0; }
                </style>
              </head>
              <body><pre>${escaped}</pre></body>
              </html>
            `);
            w.document.close();
          }
          return;
        }
        
        // Изображения - открываем через blob URL
        if (mime.startsWith("image/")) {
          const blob = new Blob([ab], { type: mime });
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          return;
        }
        
        // PDF и другие документы - открываем через blob URL
        if (mime === "application/pdf" || mime.startsWith("application/vnd.") || mime === "application/json") {
          const blob = new Blob([ab], { type: mime });
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          return;
        }
        
        // Остальные - скачиваем
        const blob = new Blob([ab], { type: mime });
        const url = URL.createObjectURL(blob);
        chrome.downloads.download(
          { url, filename: path, conflictAction: "uniquify", saveAs: false },
          () => setTimeout(() => URL.revokeObjectURL(url), 3000)
        );
      } catch (err) {
        console.error("open error:", err);
        alert("Failed to open file: " + err.message);
      }
    });
  });

  $$(".file-dl", listV).forEach(btn => {
    ensureButton(btn);
    on(btn, "click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const path = btn.dataset.path;
      const entry = currentZip.file(path);
      if (!entry) return;
      try {
        const ab = await entry.async("arraybuffer");
        const mime = extMime(path);
        // Для бинарных файлов используем application/octet-stream чтобы Chrome не переопределял тип
        const safeMime = mime.startsWith("text/") || mime === "application/json" ? mime : "application/octet-stream";
        const blob = new Blob([ab], { type: safeMime });
        const url = URL.createObjectURL(blob);
        // Очищаем путь от слешей в начале и нормализуем
        const safePath = path.replace(/^\/+/, "").replace(/\\/g, "/");

        chrome.downloads.download(
          {
            url,
            filename: safePath,
            conflictAction: "uniquify",
            saveAs: false
          },
          (downloadId) => {
            setTimeout(() => URL.revokeObjectURL(url), 3000);
            if (chrome.runtime.lastError) {
              console.error("Download error:", chrome.runtime.lastError.message);
              alert("Failed to download file: " + chrome.runtime.lastError.message);
            }
          }
        );
      } catch (err) {
        console.error("download error:", err);
        alert("Failed to download file: " + err.message);
      }
    });
  });
}

function renderZipNeedsReopen(state) {
  metaV.textContent = `Previously viewed: ${state.currentZipName} (${state.entries.length} entries)`;
  btnReopen.style.display = "inline-block";
  btnExtract.style.display = "none";

  listV.innerHTML = `
    <div class="meta reopen-message">
      <strong>📁 ZIP needs to be reopened</strong><br>
      Click "Reopen ZIP" or drop "${state.currentZipName}" again.
    </div>
    ${state.entries.map(p => `<div class="item file reopen-item"><div class="name">${p}</div><div class="meta">reopen</div></div>`).join("")}
  `;
  $$(".item.file", listV).forEach(el => on(el, "click", () => inV.click()));
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
  if (!["zip","rar","7z","tar"].includes(ext)) {
    alert("Please drop a supported archive: .zip, .rar, .7z, .tar");
    return;
  }
  if (ext !== "zip") {
    alert(`.${ext} is not supported for inline viewing. Only ZIP can be opened. The file will be saved.`);
    const url = URL.createObjectURL(file);
    chrome.downloads.download({ url, filename: file.name, conflictAction: "uniquify", saveAs: false },
      () => setTimeout(() => URL.revokeObjectURL(url), 3000));
    return;
  }
  openZip(file);
});

// click zone -> open file dialog
on(dzV, "click", (e) => { e.preventDefault(); inV.click(); });

// input change for VIEW
on(inV, "change", () => {
  const f = inV.files?.[0];
  if (f) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!["zip","rar","7z","tar"].includes(ext)) {
      alert("Please choose a supported archive: .zip, .rar, .7z, .tar");
      inV.value = "";
      return;
    }
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

    const entries = Object.keys(currentZip.files).sort();
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
    try {
      const ab = await entry.async("arraybuffer");
      // Всегда используем application/octet-stream для бинарных файлов
      // Это предотвращает попытки Chrome определить тип по содержимому
      const blob = new Blob([ab], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      // Нормализуем путь и очищаем от слешей в начале
      const safePath = name.replace(/^\/+/, "").split("\\").join("/");

      // ВАЖНО: Используем оригинальное имя файла без изменений для сохранения расширения
      const downloadPath = `${base}/${safePath}`;

      chrome.downloads.download(
        {
          url,
          filename: downloadPath,
          conflictAction: "uniquify",
          saveAs: false
        },
        (downloadId) => {
          setTimeout(() => URL.revokeObjectURL(url), 3000);
          if (chrome.runtime.lastError) {
            console.warn("Extract failed:", name, chrome.runtime.lastError.message);
          }
        }
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
on(btnReopen, "click", (e) => { e.preventDefault(); e.stopPropagation(); inV.click(); });

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
//                          DIAGNOSTICS / TIPS (one-time)
// ============================================================================
// Если вдруг скачивание блокируется политикой Chrome:
// 1) Проверь, что у расширения есть permission "downloads" в manifest.json.
// 2) Убедись, что скачивание вызывается из контекста popup (как здесь),
//    а не через передачу blob: URL в background (service worker не видит blob: из popup).
// 3) chrome://settings/downloads — проверь папку, авто-сохранение и отсутствие блокировок.
