// ======================= ZIPboost (MV3 Popup Script) =======================

// Вспомогательные функции
const $  = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const on = (el, evt, fn, opts) => el.addEventListener(evt, fn, opts);
const fmt = bytes => 
  bytes < 1024 ? `${bytes} B` :
  bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` :
  bytes < 1073741824 ? `${(bytes/1048576).toFixed(1)} MB` :
  `${(bytes/1073741824).toFixed(1)} GB`;
const sanitizeName = s => (s || "archive.zip").replace(/[\/\\:*?"<>|]/g, "_");
const extMime = (name) => {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const mimes = {
    // Изображения
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    bmp: "image/bmp", ico: "image/x-icon", tiff: "image/tiff",
    
    // Документы
    pdf: "application/pdf",
    
    // Текстовые файлы
    txt: "text/plain", md: "text/markdown", rtf: "application/rtf",
    html: "text/html", htm: "text/html", xml: "text/xml",
    css: "text/css", js: "text/javascript", json: "application/json",
    csv: "text/csv", log: "text/plain", ini: "text/plain",
    
    // Архивы
    zip: "application/zip", rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed", tar: "application/x-tar",
    
    // Аудио/Видео
    mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4",
    avi: "video/x-msvideo", mov: "video/quicktime", wmv: "video/x-ms-wmv",
    
    // Другие
    exe: "application/x-msdownload", dll: "application/x-msdownload",
    bat: "text/plain", sh: "text/plain", ps1: "text/plain"
  };
  return mimes[ext] || "application/octet-stream";
};
const canOpenInBrowser = (mimeType) => {
  const browserSupported = [
    "image/", "text/", "application/pdf", "application/json",
    "application/xml", "text/xml", "application/javascript",
    "text/javascript", "application/x-javascript"
  ];
  return browserSupported.some(type => mimeType.startsWith(type));
};
const storageGet = (keys) => new Promise(res => chrome.storage.local.get(keys, res));
const storageSet = (obj)  => new Promise(res => chrome.storage.local.set(obj, res));

// Сохранение состояния в storage
const saveState = async (state) => {
  try {
    // Если есть ZIP как Blob, сохраняем его как байты
    if (state.currentZipBlob) {
      const arrayBuffer = await state.currentZipBlob.arrayBuffer();
      state.currentZipData = Array.from(new Uint8Array(arrayBuffer));
      delete state.currentZipBlob;
    }
    // Сохраняем весь объект состояния
    await storageSet({ zipboost_state: state });
    console.log('State saved:', state);
  } catch (e) {
    console.error('Error saving state:', e);
  }
};
const loadState = async () => {
  try {
    const result = await storageGet(['zipboost_state']);
    console.log('State loaded:', result.zipboost_state);
    const state = result.zipboost_state;
    // Если сохранены байты ZIP, восстанавливаем Blob
    if (state && state.currentZipData) {
      const arr = new Uint8Array(state.currentZipData);
      state.currentZipBlob = new Blob([arr], { type: 'application/zip' });
      delete state.currentZipData;
    }
    return state || null;
  } catch (e) {
    console.error('Error loading state:', e);
    return null;
  }
};
const clearState = async () => {
  try {
    await storageSet({ zipboost_state: null });
    console.log('State cleared');
  } catch (e) {
    console.error('Error clearing state:', e);
  }
};

// Восстановление ZIP из состояния (если есть)
async function restoreZipFromState(state) {
  if (!state || !state.currentZipName || !state.entries || !state.currentZipBlob) return false;
  try {
    console.log('Restoring ZIP from saved state...');
    const zip = await JSZip.loadAsync(await state.currentZipBlob.arrayBuffer());
    currentZip = zip;
    currentZipName = state.currentZipName;
    // Переключаемся на вкладку View
    await activate(secV, tabV);
    metaV.textContent = `${state.entries.length} entries in ${state.currentZipName}`;
    // Восстанавливаем список файлов
    listV.innerHTML = state.entries.map(path => {
      const entry = zip.files[path];
      const label = entry.dir ? `[Folder] ${path}` : path;
      const right = entry.dir ? "—" : "";
      const buttons = entry.dir ? "" : `
        <div class="file-actions">
          <button class="secondary xs" data-path="${path}" data-action="open" title="Open">Open</button>
          <button class="secondary xs" data-path="${path}" data-action="download" title="Download">⬇</button>
        </div>
      `;
      return `<div class="item file" data-path="${path}">
                <div class="name" title="${path}">${label}</div>
                <div class="meta">${right}</div>
                ${buttons}
              </div>`;
    }).join("");
    console.log('ZIP successfully restored from state');
    return true;
  } catch (e) {
    console.error("Error restoring ZIP from state:", e);
    return false;
  }
}

// Функция восстановления состояния ZIP файла (если нет Blob, показываем кнопку Reopen)
async function restoreZipState(state) {
  if (!state || !state.currentZipName || !state.entries) return false;
  // Если сохранён Blob – восстановим архив
  if (state.currentZipBlob) {
    return await restoreZipFromState(state);
  }
  // Иначе – предложим переоткрыть файл
  try {
    await activate(secV, tabV);
    metaV.textContent = `Previously viewed: ${state.currentZipName} (${state.entries.length} entries)`;
    btnReopen.style.display = "inline-block";
    btnExtract.style.display = "none";
    listV.innerHTML = `
      <div class="meta" style="padding:10px; background: #1f2937; border-radius: 4px; margin-bottom: 10px; border-left: 4px solid #3b82f6;">
        <strong>📁 ZIP needs to be reopened</strong><br>
        Click "Reopen ZIP" or drop "${state.currentZipName}" again to view.
      </div>
      ${state.entries.map(path => {
        const isDir = path.endsWith('/');
        const label = isDir ? `📁 ${path}` : `📄 ${path}`;
        const right = isDir ? "—" : "reopen required";
        return `<div class="item file" data-path="${path}" style="opacity:0.7; padding:8px; border-radius:4px; background:#0f172a; cursor:pointer;" title="Click to reopen ZIP">
                  <div class="name" title="${path}">${label}</div>
                  <div class="meta">${right}</div>
                </div>`;
      }).join("")}
    `;
    // При клике на файл – открываем диалог выбора ZIP
    $$(".item.file", listV).forEach(el =>
      on(el, "click", () => inV.click())
    );
    return true;
  } catch (e) {
    console.error("Error restoring ZIP state:", e);
    return false;
  }
}

// ---------- Навигация по вкладкам ----------
const secC = $("#sec-compress"), secV = $("#sec-view");
const tabC = $("#tab-compress"), tabV = $("#tab-view");
async function activate(section, tab) {
  [secC, secV].forEach(sec => sec.classList.remove("active"));
  [tabC, tabV].forEach(t => t.classList.remove("active"));
  section.classList.add("active");
  tab.classList.add("active");
  // Сохраняем активную вкладку
  const activeTab = (section === secC) ? 'compress' : 'view';
  const currentState = await loadState() || {};
  await saveState({ ...currentState, activeTab });
}
on(tabC, "click", async () => await activate(secC, tabC));
on(tabV, "click", async () => await activate(secV, tabV));

// Показываем нужную вкладку при инициализации
(async () => {
  const savedState = await loadState();
  console.log('Initialization - savedState:', savedState);
  if (savedState && savedState.activeTab === 'view' && savedState.currentZipName) {
    console.log('Restoring ZIP from saved state...');
    await restoreZipState(savedState);
  } else if (savedState && savedState.activeTab === 'compress' && savedState.compressFiles) {
    // Восстанавливаем список файлов в Compress
    zipName.value = savedState.zipName || zipName.value;
    preset.value = savedState.preset || preset.value;
    files = savedState.compressFiles.map(f => {
      const arr = new Uint8Array(f.data);
      return new File([arr], f.name, { type: f.type });
    });
    renderCompressList();
    await activate(secC, tabC);
  } else {
    await activate(secC, tabC);
  }
})();

// Сохраняем состояние при закрытии popup
window.addEventListener('beforeunload', async () => {
  if (currentZip && currentZipName) {
    // Сохраняем ZIP в состоянии
    const entries = Object.keys(currentZip.files).sort();
    const zipBlob = await currentZip.generateAsync({ type: "blob" });
    await saveState({
      currentZipName: currentZipName,
      entries: entries,
      activeTab: 'view',
      currentZipBlob: zipBlob
    });
  } else if (files.length) {
    // Сохраняем список файлов для Compress
    const state = { activeTab: 'compress', zipName: zipName.value, preset: preset.value, compressFiles: [] };
    for (const f of files) {
      const ab = await f.arrayBuffer();
      state.compressFiles.push({ name: f.name, type: f.type, data: Array.from(new Uint8Array(ab)) });
    }
    await storageSet({ zipboost_state: state });
    console.log('Saved compress state:', state);
  }
});

// ---------- Проверка наличия библиотеки JSZip ----------
const libStatus = $("#lib-status");
let JSZIP_OK = false;
try {
  JSZIP_OK = typeof (new JSZip()).generateAsync === "function";
} catch {
  JSZIP_OK = false;
}
if (!JSZIP_OK) {
  libStatus.textContent = "JSZip not found. Make sure libs/jszip.min.js is included.";
}

// ============================================================================
//                                   COMPRESS TAB
const dzC     = $("#dz-compress"),
      inC     = $("#inp-compress"),
      listC   = $("#list-compress");
const zipName = $("#zip-name"),
      preset  = $("#zip-preset"),
      btnZip  = $("#btn-compress"),
      progC   = $("#progress");
let files = [];

// Восстанавливаем настройки архива (имя и пресет)
(async () => {
  const state = await loadState();
  if (state && state.zipName) { zipName.value = state.zipName; } else { zipName.value = "archive.zip"; }
  if (state && state.preset) { preset.value = state.preset; } else { preset.value = "optimal"; }
})();

// Функция рендеринга списка файлов для сжатия
function renderCompressList() {
  if (!files.length) {
    listC.innerHTML = `<div class="meta" style="padding:10px">No files selected.</div>`;
    return;
  }
  listC.innerHTML = files.map((f, i) => `
    <div class="item">
      <div class="name" title="${f.name}">${f.name}</div>
      <div class="meta">${fmt(f.size)}</div>
      <button class="secondary xs" data-i="${i}" title="Remove">✕</button>
    </div>
  `).join("");
  // Обработчики кнопок Remove
  $$(".item button[data-i]", listC).forEach(btn =>
    on(btn, "click", () => {
      const idx = Number(btn.getAttribute("data-i"));
      if (!Number.isNaN(idx)) {
        files.splice(idx, 1);
        renderCompressList();
      }
    })
  );
}

// Drag & Drop: добавляем файлы через перетаскивание
["dragenter","dragover"].forEach(evt =>
  on(dzC, evt, (ev) => { ev.preventDefault(); ev.stopPropagation(); dzC.classList.add("drag"); })
);
["dragleave","drop"].forEach(evt =>
  on(dzC, evt, (ev) => { ev.preventDefault(); ev.stopPropagation(); dzC.classList.remove("drag"); })
);
// Обработка drop в Compress
on(dzC, "drop", async (ev) => {
  const dt = ev.dataTransfer;
  if (!dt) return;
  // Если перетащены локальные файлы
  if (dt.files && dt.files.length > 0) {
    files.push(...Array.from(dt.files));
    renderCompressList();
  } else {
    // Если перетащена ссылка/изображение
    const url = dt.getData("text/uri-list") || dt.getData("URL") || dt.getData("text/plain");
    if (url) {
      const resp = await new Promise(res => chrome.runtime.sendMessage({ type: "FETCH_URL", url }, res));
      if (resp && resp.ok) {
        const u8 = new Uint8Array(resp.buffer);
        const blob = new Blob([u8], { type: resp.mime });
        const file = new File([blob], resp.name, { type: blob.type });
        files.push(file);
        renderCompressList();
      } else {
        console.warn("Не удалось загрузить URL:", resp?.error);
      }
    }
  }
});

// Клик по области — открываем диалог выбора файлов
on(dzC, "click", () => inC.click());

// Выбор файлов через стандартный диалог
on(inC, "change", () => {
  const chosen = Array.from(inC.files || []);
  if (chosen.length) {
    files = chosen;
    renderCompressList();
  }
  inC.value = ""; // сбрасываем input
});

// Обработка кнопки "Compress to ZIP"
on(btnZip, "click", async () => {
  if (!JSZIP_OK) {
    alert("JSZip library not loaded.");
    return;
  }
  if (!files.length) {
    alert("Add files first.");
    return;
  }
  // Сохраняем настройки архива в локальное хранилище
  await storageSet({ zipboost_state: { ...await loadState(), zipName: zipName.value, preset: preset.value, activeTab: 'compress' } });

  const level = preset.value === "quick" ? 1 : (preset.value === "maximum" ? 9 : 6);
  const name  = sanitizeName(zipName.value || "archive.zip");

  btnZip.disabled = true;
  progC.textContent = "Packing…";
  try {
    const zip = new JSZip();
    for (const f of files) {
      zip.file(f.name, f);
    }
    const blob = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level }, streamFiles: true },
      metadata => {
        if (metadata.percent != null) {
          progC.textContent = `Packing… ${Math.round(metadata.percent)}%`;
        }
      }
    );
    const url = URL.createObjectURL(blob);
    // Сохраняем ZIP через background.js
    chrome.runtime.sendMessage({ type: "download", payload: { url, filename: name } }, res => {
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      progC.textContent = res?.ok
        ? "ZIP archive saved to Downloads."
        : (res?.lastError || "ZIP saved.");
    });
  } catch (e) {
    console.error("Compression error:", e);
    alert("Compression failed: " + e.message);
  } finally {
    btnZip.disabled = false;
  }
});

// ============================================================================

//                                  VIEW TAB
const dzV         = $("#dz-view"),
      inV         = $("#inp-zip"),
      listV       = $("#list-zip"),
      metaV       = $("#zip-meta"),
      btnExtract  = $("#btn-extract-all"),
      btnReopen   = $("#btn-reopen-zip"),
      btnClear    = $("#btn-clear-state");
let currentZip       = null,
    currentZipName   = "archive.zip";

// Drag & Drop для View (архивы)
["dragenter","dragover"].forEach(evt =>
  on(dzV, evt, (ev) => { ev.preventDefault(); ev.stopPropagation(); dzV.classList.add("drag"); })
);
["dragleave","drop"].forEach(evt =>
  on(dzV, evt, (ev) => { ev.preventDefault(); ev.stopPropagation(); dzV.classList.remove("drag"); })
);
on(dzV, "drop", (ev) => {
  const dt = ev.dataTransfer;
  if (!dt) return;
  if (dt.files && dt.files.length > 0) {
    const file = dt.files[0];
    const ext = file.name.split(".").pop().toLowerCase();
    if (["zip","rar","7z","tar"].includes(ext)) {
      if (ext === "zip") {
        openZip(file);
      } else {
        // Для RAR/7Z/TAR просто сохраняем файл (просмотр не поддерживается)
        const url = URL.createObjectURL(file);
        chrome.runtime.sendMessage({ type: "download", payload: { url, filename: file.name } });
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }
    } else {
      alert("Только файлы ZIP, RAR, 7Z и TAR разрешены.");
    }
  }
});
on(dzV, "click", () => inV.click());
on(inV, "change", () => {
  const file = inV.files?.[0];
  if (file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (["zip","rar","7z","tar"].includes(ext)) {
      if (ext === "zip") {
        openZip(file);
      } else {
        const url = URL.createObjectURL(file);
        chrome.runtime.sendMessage({ type: "download", payload: { url, filename: file.name } });
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }
    } else {
      alert("Только файлы ZIP, RAR, 7Z и TAR разрешены.");
    }
  }
});

// Открытие ZIP: читаем через JSZip и показываем содержимое
async function openZip(file) {
  if (!JSZIP_OK) {
    alert("JSZip library not loaded.");
    return;
  }
  try {
    await clearState();
    metaV.textContent = `Loading ${file.name}…`;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    currentZip = zip;
    currentZipName = file.name;

    const entries = Object.keys(zip.files).sort();
    listV.innerHTML = entries.map(path => {
      const entry = zip.files[path];
      const label = entry.dir ? `[Folder] ${path}` : path;
      const right = entry.dir ? "—" : "";
      const buttons = entry.dir ? "" : `
        <div class="file-actions">
          <button class="secondary xs" data-path="${path}" data-action="open" title="Open">Open</button>
          <button class="secondary xs" data-path="${path}" data-action="download" title="Download">⬇</button>
        </div>
      `;
      return `<div class="item file" data-path="${path}">
                <div class="name" title="${path}">${label}</div>
                <div class="meta">${right}</div>
                ${buttons}
              </div>`;
    }).join("");
    metaV.textContent = `${entries.length} entries in ${file.name}`;

    await saveState({
      currentZipName: file.name,
      entries: entries,
      activeTab: 'view',
      currentZipBlob: file
    });

    await activate(secV, tabV);
    btnReopen.style.display = "none";
    btnExtract.style.display = "inline-block";

    // Действия по файлам в списке
    $$(".item.file button[data-path]", listV).forEach(btn =>
      on(btn, "click", async (e) => {
        e.stopPropagation();
        const path = btn.getAttribute("data-path");
        const action = btn.getAttribute("data-action");
        const entry = currentZip.file(path);
        if (!entry) return;
        try {
          const ab = await entry.async("arraybuffer");
          const mimeType = extMime(path);
          const blob = new Blob([ab], { type: mimeType });
          const url = URL.createObjectURL(blob);
          if (action === "open") {
            await saveState({
              currentZipName: currentZipName,
              entries: entries,
              activeTab: 'view',
              currentZipBlob: file,
              lastOpenedFile: path
            });
            if (canOpenInBrowser(mimeType)) {
              window.open(url, "_blank");
              setTimeout(() => URL.revokeObjectURL(url), 10000);
            } else {
              chrome.runtime.sendMessage(
                { type: "download", payload: { url, filename: path } },
                (res) => {
                  setTimeout(() => URL.revokeObjectURL(url), 3000);
                  if (res?.ok) {
                    console.log(`Downloaded: ${path}`);
                  } else {
                    console.error("Download failed:", res?.lastError);
                  }
                }
              );
            }
          } else if (action === "download") {
            chrome.runtime.sendMessage(
              { type: "download", payload: { url, filename: path } },
              (res) => {
                setTimeout(() => URL.revokeObjectURL(url), 3000);
                if (!res?.ok) console.error("Download failed:", res?.lastError);
              }
            );
          }
        } catch (e) {
          console.error("File action error:", e);
          alert(`Failed to ${action} file: ` + e.message);
        }
      })
    );
  } catch (e) {
    console.error("ZIP open error:", e);
    alert("Unable to read ZIP (maybe corrupted or invalid).");
  }
}

// Извлечение всех файлов из архива
on(btnExtract, "click", async () => {
  if (!currentZip) {
    alert("Open a ZIP first.");
    return;
  }
  const base = currentZipName.replace(/\.zip$/i, "");
  const entries = Object.entries(currentZip.files);
  let count = 0;
  for (const [name, entry] of entries) {
    if (entry.dir) continue;
    try {
      const ab = await entry.async("arraybuffer");
      const blob = new Blob([ab], { type: extMime(name) });
      const url = URL.createObjectURL(blob);
      const safePath = name.split("\\").join("/");
      chrome.runtime.sendMessage(
        { type: "download", payload: { url, filename: `${base}/${safePath}` } },
        () => setTimeout(() => URL.revokeObjectURL(url), 3000)
      );
      count++;
    } catch (e) {
      console.warn("Extract failed for:", name, e);
    }
  }
  metaV.textContent = `Extracted ${count} file(s) to Downloads/${base}/`;
});

// Переоткрытие ZIP-файла (кнопка Reopen)
on(btnReopen, "click", () => inV.click());

// Очистка состояния и возврат к началу
on(btnClear, "click", async () => {
  await clearState();
  currentZip = null;
  currentZipName = "archive.zip";
  listV.innerHTML = "";
  metaV.textContent = "";
  btnReopen.style.display = "none";
  btnExtract.style.display = "inline-block";
  await activate(secC, tabC);
});
