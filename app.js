// ======================= ZIPboost (MV3 Popup Script) =======================
// Полностью автономный popup: Drag & Drop, сжатие, просмотр, распаковка ZIP,
// локальный аккаунт (chrome.storage.local), сохранение настроек между сессиями.

// ---------- Helper Functions ----------
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
    // Images
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    bmp: "image/bmp", ico: "image/x-icon", tiff: "image/tiff",
    
    // Documents
    pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    
    // Text files
    txt: "text/plain", md: "text/markdown", rtf: "application/rtf",
    html: "text/html", htm: "text/html", xml: "text/xml",
    css: "text/css", js: "text/javascript", json: "application/json",
    csv: "text/csv", log: "text/plain", ini: "text/plain",
    
    // Archives
    zip: "application/zip", rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed", tar: "application/x-tar",
    gz: "application/gzip", bz2: "application/x-bzip2",
    
    // Audio/Video
    mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4",
    avi: "video/x-msvideo", mov: "video/quicktime", wmv: "video/x-ms-wmv",
    
    // Other
    exe: "application/x-msdownload", dll: "application/x-msdownload",
    bat: "text/plain", sh: "text/plain", ps1: "text/plain"
  };
  
  // Если расширение найдено, возвращаем соответствующий MIME-тип
  if (mimes[ext]) {
    return mimes[ext];
  }
  
  // Для неизвестных расширений пытаемся определить по содержимому
  // Пока что возвращаем общий тип для текстовых файлов
  return "text/plain";
};

// Функция для определения, можно ли открыть файл в браузере
const canOpenInBrowser = (mimeType) => {
  const browserSupportedTypes = [
    "image/", "text/", "application/pdf", "application/json",
    "application/xml", "text/xml", "application/javascript",
    "text/javascript", "application/x-javascript"
  ];
  
  return browserSupportedTypes.some(type => mimeType.startsWith(type));
};
const storageGet = (keys)    => new Promise(res => chrome.storage.local.get(keys, res));
const storageSet = (obj)     => new Promise(res => chrome.storage.local.set(obj, res));

// Функции для сохранения и восстановления состояния
const saveState = async (state) => {
  try {
    // Если есть ZIP файл, сохраняем его как Blob
    if (state.currentZipBlob) {
      // Конвертируем Blob в ArrayBuffer для сохранения
      const arrayBuffer = await state.currentZipBlob.arrayBuffer();
      state.currentZipData = Array.from(new Uint8Array(arrayBuffer));
      delete state.currentZipBlob; // Удаляем Blob, оставляем только данные
    }
    
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
    
    if (result.zipboost_state && result.zipboost_state.currentZipData) {
      // Восстанавливаем Blob из сохраненных данных
      const uint8Array = new Uint8Array(result.zipboost_state.currentZipData);
      result.zipboost_state.currentZipBlob = new Blob([uint8Array], { type: 'application/zip' });
      delete result.zipboost_state.currentZipData; // Удаляем данные, оставляем Blob
    }
    
    return result.zipboost_state || null;
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

// Функция для восстановления ZIP файла из сохраненного состояния
async function restoreZipFromState(state) {
  if (!state || !state.currentZipName || !state.entries || !state.currentZipBlob) return false;
  
  try {
    console.log('Restoring ZIP from saved state...');
    
    // Восстанавливаем ZIP объект из сохраненного Blob
    const zip = await JSZip.loadAsync(await state.currentZipBlob.arrayBuffer());
    currentZip = zip;
    currentZipName = state.currentZipName;
    
    // Переключаемся на вкладку View
    await activate(secV, tabV);
    
    // Обновляем метаинформацию
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
    
    // Восстанавливаем обработчики для кнопок действий
    $$(".item.file button[data-path]", listV).forEach(btn =>
      on(btn, "click", async (e) => {
        e.stopPropagation();
        const path = btn.getAttribute("data-path");
        const action = btn.getAttribute("data-action");
        const entry = currentZip.file(path);
        if (!entry) return;
        
        try {
          const arrayBuffer = await entry.async("arraybuffer");
          const mimeType = extMime(path);
          const blob = new Blob([arrayBuffer], { type: mimeType });
          const url = URL.createObjectURL(blob);
          
          if (action === "open") {
            // Сохраняем состояние перед открытием файла
            await saveState({
              currentZipName: currentZipName,
              entries: state.entries,
              activeTab: 'view',
              currentZipBlob: state.currentZipBlob,
              lastOpenedFile: path
            });
            
            // Проверяем, можно ли открыть файл в браузере
            if (canOpenInBrowser(mimeType)) {
              window.open(url, "_blank");
              setTimeout(() => URL.revokeObjectURL(url), 10000);
            } else {
              // Если нельзя открыть в браузере, скачиваем файл
              chrome.runtime.sendMessage(
                { type: "download", payload: { url, filename: path } },
                (res) => {
                  setTimeout(() => URL.revokeObjectURL(url), 3000);
                  if (res?.ok) {
                    console.log(`Downloaded: ${path} (cannot open in browser)`);
                  } else {
                    console.error("Download failed:", res?.lastError);
                  }
                }
              );
            }
          } else if (action === "download") {
            // Скачиваем файл через background script
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
        } catch (e) {
          console.error("File action error:", e);
          alert(`Failed to ${action} file: ` + e.message);
        }
      })
    );
    
    // Скрываем кнопку "Reopen ZIP" и показываем "Extract all"
    btnReopen.style.display = "none";
    btnExtract.style.display = "inline-block";
    
    console.log('ZIP successfully restored from state');
    return true;
  } catch (e) {
    console.error("Error restoring ZIP from state:", e);
    return false;
  }
}

// Функция для восстановления состояния ZIP файла (fallback)
async function restoreZipState(state) {
  if (!state || !state.currentZipName || !state.entries) return false;
  
  // Если есть сохраненный Blob, пытаемся восстановить ZIP
  if (state.currentZipBlob) {
    return await restoreZipFromState(state);
  }
  
  // Иначе показываем интерфейс для переоткрытия
  try {
    // Переключаемся на вкладку View
    await activate(secV, tabV);
    
    // Показываем сообщение о том, что нужно переоткрыть ZIP файл
    metaV.textContent = `Previously viewed: ${state.currentZipName} (${state.entries.length} entries)`;
    
    // Показываем кнопку "Reopen ZIP"
    btnReopen.style.display = "inline-block";
    btnExtract.style.display = "none";
    
    // Показываем список файлов с пометкой, что нужно переоткрыть
    listV.innerHTML = `
      <div class="meta" style="padding:10px; background: #1f2937; border-radius: 4px; margin-bottom: 10px; border-left: 4px solid #3b82f6;">
        <strong>📁 ZIP file needs to be reopened</strong><br>
        Click "Reopen ZIP" button or drop the ZIP file "${state.currentZipName}" again to view its contents
      </div>
      ${state.entries.map(path => {
        const isDir = path.endsWith('/');
        const label = isDir ? `📁 ${path}` : `📄 ${path}`;
        const right = isDir ? "—" : "reopen required";
        return `<div class="item file" data-path="${path}" style="opacity: 0.7; padding: 8px; border-radius: 4px; background: #0f172a; cursor: pointer;" title="Click to reopen ZIP file">
                  <div class="name" title="${path}">${label}</div>
                  <div class="meta">${right}</div>
                </div>`;
      }).join("")}
    `;
    
    // Добавляем обработчики кликов для файлов в восстановленном состоянии
    $$(".item.file", listV).forEach(el =>
      on(el, "click", () => {
        inV.click();
      })
    );
    
    return true;
  } catch (e) {
    console.error("Error restoring ZIP state:", e);
    return false;
  }
}

// ---------- Tab Navigation ----------
const secC = $("#sec-compress"),
      secV = $("#sec-view");
const tabC = $("#tab-compress"),
      tabV = $("#tab-view");
async function activate(section, tab) {
  [secC, secV].forEach(sec => sec.classList.remove("active"));
  [tabC, tabV].forEach(t => t.classList.remove("active"));
  section.classList.add("active");
  tab.classList.add("active");
  
  // Сохраняем активную вкладку
  const activeTab = section === secC ? 'compress' : 'view';
  const currentState = await loadState() || {};
  await saveState({ ...currentState, activeTab });
}
on(tabC, "click", async () => await activate(secC, tabC));
on(tabV, "click", async () => await activate(secV, tabV));
// Показ нужной вкладки при открытии (по hash в URL, если задано)
(async () => {
  const h = (location.hash || "").toLowerCase();
  const savedState = await loadState();
  
  console.log('Initialization - hash:', h, 'savedState:', savedState);
  
  if (h.includes("view")) {
    await activate(secV, tabV);
  } else if (savedState && savedState.activeTab === 'view' && savedState.currentZipName) {
    // Восстанавливаем состояние ZIP файла
    console.log('Restoring ZIP state...');
    await restoreZipState(savedState);
  } else {
    await activate(secC, tabC);
  }
})();

// Убираем все drag & drop обработчики - оставляем только click для выбора файлов

// Сохраняем состояние при закрытии popup
window.addEventListener('beforeunload', async () => {
  if (currentZip && currentZipName) {
    const entries = Object.keys(currentZip.files).sort();
    
    // Получаем Blob из ZIP объекта
    const zipBlob = await currentZip.generateAsync({ type: "blob" });
    
    await saveState({
      currentZipName: currentZipName,
      entries: entries,
      activeTab: 'view',
      currentZipBlob: zipBlob
    });
  }
});

// Периодическое сохранение состояния каждые 5 секунд
setInterval(async () => {
  if (currentZip && currentZipName) {
    const entries = Object.keys(currentZip.files).sort();
    const activeTab = secV.classList.contains('active') ? 'view' : 'compress';
    
    // Получаем текущий Blob из ZIP объекта
    const zipBlob = await currentZip.generateAsync({ type: "blob" });
    
    await saveState({
      currentZipName: currentZipName,
      entries: entries,
      activeTab: activeTab,
      currentZipBlob: zipBlob
    });
  }
}, 5000);

// ---------- JSZip Availability Check ----------
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
//                               COMPRESS TAB
// ============================================================================

const dzC     = $("#dz-compress"),
      inC     = $("#inp-compress"),
      listC   = $("#list-compress");
const zipName = $("#zip-name"),
      preset  = $("#zip-preset"),
      btnZip  = $("#btn-compress"),
      progC   = $("#progress");
let files = [];


// Восстанавливаем прошлые настройки (имя архива и пресет)
(async () => {
  const { lastZipName, lastPreset } = await storageGet(["lastZipName", "lastPreset"]);
  // Устанавливаем дефолтное значение archive.zip если сохраненное значение содержит .tar
  if (lastZipName && !lastZipName.includes('.tar')) {
    zipName.value = lastZipName;
  } else {
    zipName.value = "archive.zip";
  }
  if (lastPreset) preset.value = lastPreset;
})();

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
  // Bind remove buttons for each file item
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

// Клик по зоне загрузки открывает диалог выбора файлов
on(dzC, "click", () => inC.click());

// Выбор файлов через диалог – заменяем текущий список файлов на новые
on(inC, "change", () => {
  const chosen = Array.from(inC.files || []);
  if (chosen.length) {
    files = chosen;
    renderCompressList();
  }
  inC.value = ""; // сбрасываем input, чтобы повторный выбор тех же файлов тоже срабатывал
});

// Простой click для выбора файлов
on(dzC, "click", () => inpC.click());


// Обработка нажатия кнопки "Compress to ZIP"
on(btnZip, "click", async () => {
  if (!JSZIP_OK) {
    return alert("JSZip is not loaded.");
  }
  if (!files.length) {
    return alert("Add files first.");
  }
  // Сохраняем текущие настройки в storage
  await storageSet({ 
    lastZipName: zipName.value, 
    lastPreset: preset.value 
  });

  // Определяем уровень сжатия: quick=1, maximum=9, остальное (optimal)=6
  const lvl  = preset.value === "quick" ? 1 : (preset.value === "maximum" ? 9 : 6);
  const name = sanitizeName(zipName.value || "archive.zip");

  btnZip.disabled = true;
  progC.textContent = "Packing…";
  try {
    const zip = new JSZip();
    for (const f of files) {
      zip.file(f.name, f);
    }
    
    // Генерация ZIP архива (асинхронно) с отслеживанием прогресса
    const blob = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level: lvl }, streamFiles: true },
      (metadata) => {
        if (metadata && metadata.percent != null) {
          progC.textContent = `Packing… ${Math.round(metadata.percent)}%`;
        }
      }
    );
    const url = URL.createObjectURL(blob);
    // Отправляем Blob-URL в background для сохранения файла
    chrome.runtime.sendMessage({ type: "download", payload: { url, filename: name } }, (res) => {
      // Высвобождаем URL спустя немного времени
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      progC.textContent = res?.ok
        ? "ZIP archive saved to Downloads."
        : (res?.lastError || "ZIP archive saved.");
    });
  } catch (e) {
    console.error("Compression error:", e);
    alert("Compression failed: " + e.message);
  } finally {
    btnZip.disabled = false;
  }
});
// ============================================================================
//                                 VIEW TAB
// ============================================================================

const dzV       = $("#dz-view"),
      inV       = $("#inp-zip"),
      listV     = $("#list-zip"),
      metaV     = $("#zip-meta"),
      btnExtract = $("#btn-extract-all"),
      btnReopen = $("#btn-reopen-zip"),
      btnClear  = $("#btn-clear-state");
let currentZip  = null,
    currentZipName = "archive.zip";

// Простой click для выбора ZIP файла
on(dzV, "click", () => inV.click());

on(inV, "change", () => {
  const file = inV.files?.[0];
  if (file) {
    openZip(file);
  }
});

// Открытие ZIP-файла: чтение через JSZip и отображение списка содержимого
async function openZip(file) {
  if (!JSZIP_OK) {
    return alert("JSZip is not loaded.");
  }
  try {
    // Очищаем предыдущее состояние
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

    // Сохраняем состояние ZIP файла с Blob
    await saveState({
      currentZipName: file.name,
      entries: entries,
      activeTab: 'view',
      currentZipBlob: file
    });
    
    // Переключаемся на вкладку View
    await activate(secV, tabV);
    
    // Скрываем кнопку "Reopen ZIP" и показываем "Extract all"
    btnReopen.style.display = "none";
    btnExtract.style.display = "inline-block";

    // Обработчики для кнопок действий
    $$(".item.file button[data-path]", listV).forEach(btn =>
      on(btn, "click", async (e) => {
        e.stopPropagation();
        const path = btn.getAttribute("data-path");
        const action = btn.getAttribute("data-action");
        const entry = currentZip.file(path);
        if (!entry) return;
        
        try {
          const arrayBuffer = await entry.async("arraybuffer");
          const mimeType = extMime(path);
          const blob = new Blob([arrayBuffer], { type: mimeType });
          const url = URL.createObjectURL(blob);
          
          if (action === "open") {
            // Сохраняем состояние перед открытием файла
            await saveState({
              currentZipName: currentZipName,
              entries: entries,
              activeTab: 'view',
              currentZipBlob: file,
              lastOpenedFile: path
            });
            
            // Проверяем, можно ли открыть файл в браузере
            if (canOpenInBrowser(mimeType)) {
              window.open(url, "_blank");
              setTimeout(() => URL.revokeObjectURL(url), 10000);
            } else {
              // Если нельзя открыть в браузере, скачиваем файл
              chrome.runtime.sendMessage(
                { type: "download", payload: { url, filename: path } },
                (res) => {
                  setTimeout(() => URL.revokeObjectURL(url), 3000);
                  if (res?.ok) {
                    console.log(`Downloaded: ${path} (cannot open in browser)`);
                  } else {
                    console.error("Download failed:", res?.lastError);
                  }
                }
              );
            }
          } else if (action === "download") {
            // Скачиваем файл через background script
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

// Кнопка "Extract All" – извлекаем все файлы из текущего ZIP
on(btnExtract, "click", async () => {
  if (!currentZip) {
    return alert("Open a ZIP first.");
  }
  // Базовая папка для извлечения: Downloads/[archive_name]/
  const base = currentZipName.replace(/\.zip$/i, "");
  const entries = Object.entries(currentZip.files);
  let count = 0;
  for (const [name, entry] of entries) {
    if (entry.dir) continue; // пропускаем каталоги, создадим их автоматически через имя файла
    try {
      const arrayBuffer = await entry.async("arraybuffer");
      const blob = new Blob([arrayBuffer], { type: extMime(name) });
      const url = URL.createObjectURL(blob);
      // Заменяем слэши Windows-формата на Unix (для корректного пути)
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

// Кнопка "Reopen ZIP" – открывает диалог выбора файла
on(btnReopen, "click", () => {
  inV.click();
});

// Кнопка "Clear" – очищает состояние и возвращает к главной странице
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

// ---------- Подсказка по DnD ссылок (если нет <all_urls>) ----------
(async () => {
  try {
    const perms = await chrome.permissions?.getAll?.();
    const hasAllUrls = perms?.origins?.some?.(o => o === "<all_urls>");
    if (!hasAllUrls) {
      const hint = document.createElement("div");
      hint.className = "meta";
      hint.style.marginTop = "6px";
      hint.innerHTML = `Tip: to drag <b>links/images from web pages</b>, add 
        <code>host_permissions: ["&lt;all_urls&gt;"]</code> and handle FETCH_URL in background.js.`;
      dzC.insertAdjacentElement("afterend", hint);
    }
  } catch {}
})();
