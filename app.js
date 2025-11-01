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
    webp:"image/webp", svg:"image/svg+xml", bmp:"image/bmp", ico:"image/x-icon", tiff:"image/tiff",
    // docs
    pdf:"application/pdf", doc:"application/msword",
    docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls:"application/vnd.ms-excel",
    xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt:"application/vnd.ms-powerpoint",
    pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
    // text/code
    txt:"text/plain", md:"text/markdown", rtf:"application/rtf",
    html:"text/html", htm:"text/html", xml:"text/xml",
    css:"text/css", js:"text/javascript", json:"application/json",
    csv:"text/csv", log:"text/plain", ini:"text/plain",
    // archives
    zip:"application/zip", rar:"application/x-rar-compressed",
    "7z":"application/x-7z-compressed", tar:"application/x-tar",
    gz:"application/gzip", bz2:"application/x-bzip2",
    // av
    mp3:"audio/mpeg", wav:"audio/wav", mp4:"video/mp4", avi:"video/x-msvideo",
    mov:"video/quicktime", wmv:"video/x-ms-wmv",
    // other
    exe:"application/x-msdownload", dll:"application/x-msdownload",
    bat:"text/plain", sh:"text/plain", ps1:"text/plain"
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

// Safe Chrome API detection and fallbacks for web context
const HAS_CHROME = typeof chrome === "object" && chrome && chrome.storage && chrome.storage.local;

const storageGet = async (keys) => {
  if (HAS_CHROME) return await new Promise(r => chrome.storage.local.get(keys, r));
  // Fallback to localStorage
  const out = {};
  for (const k of Array.isArray(keys) ? keys : [keys]) {
    try {
      const raw = localStorage.getItem(k);
      out[k] = raw ? JSON.parse(raw) : undefined;
    } catch { out[k] = undefined; }
  }
  return out;
};

const storageSet = async (obj) => {
  if (HAS_CHROME) return await new Promise(r => chrome.storage.local.set(obj, r));
  Object.entries(obj || {}).forEach(([k, v]) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  });
};

function safeDownload(url, filename) {
  if (typeof chrome === "object" && chrome?.downloads?.download) {
    chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false }, () => {});
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

async function fetchUrlData(url) {
  // Try background fetch via extension if available
  if (typeof chrome === "object" && chrome?.runtime?.sendMessage) {
    try {
      const resp = await new Promise(res => chrome.runtime.sendMessage({ type: "FETCH_URL", url }, res));
      if (resp?.ok) return resp;
    } catch {}
  }
  // Fallback: direct fetch
  const r = await fetch(url);
  const buffer = await r.arrayBuffer();
  const mime = r.headers.get("content-type") || "application/octet-stream";
  const nameGuess = (() => { try { return new URL(url).pathname.split("/").pop() || "file"; } catch { return "file"; } })();
  return { ok: true, buffer, mime, name: nameGuess };
}

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
const btnTheme = $("#btn-theme-toggle");
const themeIcon = btnTheme?.querySelector(".theme-icon");

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

// ============================================================================
//                               THEME TOGGLE
// ============================================================================
const THEMES = {
  dark: { file: "dark-blue.css", icon: "🌙" },
  light: { file: "light-blue.css", icon: "☀️" }
};

let currentTheme = "dark"; // default

function getThemeLink() {
  return document.querySelector('#theme-link') || document.querySelector('link[href*="/themes/"]');
}

async function initTheme() {
  const saved = (await storageGet(["zipboost_theme"])).zipboost_theme;
  if (saved && (saved === "dark" || saved === "light")) {
    currentTheme = saved;
  }
  applyTheme(currentTheme, false);
}

function applyTheme(theme, save = true) {
  currentTheme = theme;
  const link = getThemeLink();
  if (link) {
    link.href = `../public/themes/${THEMES[theme].file}`;
  } else {
    // создаем ссылку если её нет
    const newLink = document.createElement("link");
    newLink.rel = "stylesheet";
    newLink.href = `../public/themes/${THEMES[theme].file}`;
    document.head.appendChild(newLink);
  }
  
  if (themeIcon) {
    themeIcon.textContent = THEMES[theme].icon;
  }
  
  if (save) {
    storageSet({ zipboost_theme: theme });
  }
}

function toggleTheme() {
  const next = currentTheme === "dark" ? "light" : "dark";
  applyTheme(next);
}

if (btnTheme) {
  ensureButton(btnTheme);
  on(btnTheme, "click", toggleTheme);
}

// Инициализация темы при загрузке
initTheme();

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
      const resp = await fetchUrlData(url);
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

// open file dialog from zone - используем делегирование событий для надежности
function setupFileInputClick() {
  // Проверяем элементы
  const dzC = $("#dz-compress");
  const inC = $("#inp-compress");
  
  if (dzC && inC) {
    dzC.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      inC.click();
    });
  } else {
    // Если элементы еще не найдены, используем делегирование от document
    document.addEventListener("click", function(e) {
      const target = e.target;
      if (target && (target.id === "dz-compress" || (target.closest && target.closest("#dz-compress")))) {
        e.preventDefault();
        e.stopPropagation();
        const input = $("#inp-compress");
        if (input) input.click();
      }
    });
  }
}

// Вызываем сразу и также при загрузке DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupFileInputClick);
} else {
  setupFileInputClick();
}

// input change
if (inC) {
  on(inC, "change", async () => {
    const chosen = Array.from(inC.files || []);
    if (chosen.length) {
      files = chosen;
      renderCompressList();
      await persistCompressState();
    }
    inC.value = "";
  });
}

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

    // Download via Chrome API if present, otherwise via anchor fallback
    safeDownload(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    progC.textContent = "ZIP saved.";
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
    const right = entry.dir ? "—" : "";
    const buttons = entry.dir ? "" : `
      <div class="file-actions">
        <button class="secondary xs file-open" data-path="${path}" title="Open" type="button">Open</button>
        <button class="secondary xs file-dl"   data-path="${path}" title="Download" type="button">⬇</button>
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
        const blob = new Blob([ab], { type: mime });
        const url = URL.createObjectURL(blob);

        if (canOpenInBrowser(mime)) {
          window.open(url, "_blank");
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } else {
          safeDownload(url, path);
          setTimeout(() => URL.revokeObjectURL(url), 3000);
        }
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
        const blob = new Blob([ab], { type: extMime(path) });
        const url = URL.createObjectURL(blob);
        safeDownload(url, path);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
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
    <div class="meta" style="padding:10px; background:#1f2937; border-radius:4px; margin-bottom:10px; border-left:4px solid #3b82f6;">
      <strong>📁 ZIP needs to be reopened</strong><br>
      Click "Reopen ZIP" or drop "${state.currentZipName}" again.
    </div>
    ${state.entries.map(p => `<div class="item file" style="opacity:.7; padding:8px; border-radius:4px; background:#0f172a; cursor:pointer;"><div class="name">${p}</div><div class="meta">reopen</div></div>`).join("")}
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
    safeDownload(url, file.name);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    return;
  }
  openZip(file);
});

// click zone -> open file dialog для VIEW
function setupZipInputClick() {
  const dzV = $("#dz-view");
  const inV = $("#inp-zip");
  
  if (dzV && inV) {
    dzV.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      inV.click();
    });
  } else {
    // Делегирование если элементы не найдены
    document.addEventListener("click", function(e) {
      const target = e.target;
      if (target && (target.id === "dz-view" || (target.closest && target.closest("#dz-view")))) {
        e.preventDefault();
        e.stopPropagation();
        const input = $("#inp-zip");
        if (input) input.click();
      }
    });
  }
}

// Вызываем сразу и также при загрузке DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupZipInputClick);
} else {
  setupZipInputClick();
}

// input change for VIEW
if (inV) {
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
        safeDownload(url, f.name);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      } else {
        openZip(f);
      }
    }
    inV.value = "";
  });
}

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
      const blob = new Blob([ab], { type: extMime(name) });
      const url = URL.createObjectURL(blob);
      const safePath = name.split("\\").join("/");
      safeDownload(url, `${base}/${safePath}`);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
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
