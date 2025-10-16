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
    png:  "image/png",
    jpg:  "image/jpeg", jpeg: "image/jpeg",
    gif:  "image/gif",  webp: "image/webp", svg: "image/svg+xml",
    pdf:  "application/pdf", txt: "text/plain", md: "text/markdown",
    html: "text/html", css: "text/css", js: "text/javascript",
    json: "application/json", csv: "text/csv"
  };
  return mimes[ext] || "application/octet-stream";
};
const storageGet = (keys)    => new Promise(res => chrome.storage.local.get(keys, res));
const storageSet = (obj)     => new Promise(res => chrome.storage.local.set(obj, res));

// ---------- Tab Navigation ----------
const secC = $("#sec-compress"),
      secV = $("#sec-view"),
      secA = $("#sec-account");
const tabC = $("#tab-compress"),
      tabV = $("#tab-view"),
      tabA = $("#tab-account");
function activate(section, tab) {
  [secC, secV, secA].forEach(sec => sec.classList.remove("active"));
  [tabC, tabV, tabA].forEach(t => t.classList.remove("active"));
  section.classList.add("active");
  tab.classList.add("active");
}
on(tabC, "click", () => activate(secC, tabC));
on(tabV, "click", () => activate(secV, tabV));
on(tabA, "click", () => activate(secA, tabA));
// Показ нужной вкладки при открытии (по hash в URL, если задано)
(() => {
  const h = (location.hash || "").toLowerCase();
  if      (h.includes("view"))    activate(secV, tabV);
  else if (h.includes("account")) activate(secA, tabA);
  else                            activate(secC, tabC);
})();

// Глобально блокируем дефолтное поведение для Drag&Drop, чтобы при бросании файлов/ссылок
// на окно popup они не открывали файл/URL в текущей вкладке браузера.
["dragover", "drop"].forEach(evt =>
  window.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }, true)
);

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
  if (lastZipName) zipName.value = lastZipName;
  if (lastPreset)  preset.value  = lastPreset;
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

// Drag & Drop для файлов и URL
on(dzC, "dragenter", () => dzC.classList.add("drag"));
on(dzC, "dragleave", () => dzC.classList.remove("drag"));
on(dzC, "drop", async (e) => {
  dzC.classList.remove("drag");
  const dt = e.dataTransfer;
  // 1) Если бросят файлы из ОС
  if (dt?.files?.length) {
    files = Array.from(dt.files);
    renderCompressList();
    return;
  }
  // 2) Если бросят ссылку или изображение с веб-страницы
  const url = dt?.getData("URL") || dt?.getData("text/uri-list") || dt?.getData("text/plain");
  if (url) {
    await tryAddUrlAsFile(url);
  }
});

// Вспомогательные функции для Drag&Drop URL через background fetch
async function fetchViaSW(url) {
  return new Promise(res => chrome.runtime.sendMessage({ type: "FETCH_URL", url }, res));
}
async function tryAddUrlAsFile(url) {
  try {
    const r = await fetchViaSW(url);
    if (r?.ok && r.buffer) {
      const u8   = new Uint8Array(r.buffer);
      const blob = new Blob([u8], { type: r.mime || "application/octet-stream" });
      const name = r.name || (new URL(url)).pathname.split("/").pop() || "file";
      files = [ ...files, new File([blob], name, { type: blob.type }) ];
      renderCompressList();
    } else {
      alert("Dragging web links/images requires host_permissions: <all_urls> (already in manifest). Reload extension if needed.");
    }
  } catch (e) {
    console.warn("FETCH_URL error:", e);
    alert("Could not fetch dropped URL.");
  }
}

// Обработка нажатия кнопки "Compress to ZIP"
on(btnZip, "click", async () => {
  if (!JSZIP_OK) {
    return alert("JSZip is not loaded.");
  }
  if (!files.length) {
    return alert("Add files first.");
  }
  // Сохраняем текущее имя архива и пресет в storage
  await storageSet({ lastZipName: zipName.value, lastPreset: preset.value });

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
        ? "Saved to Downloads."
        : (res?.lastError || "Saved.");
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
      btnExtract = $("#btn-extract-all");
let currentZip  = null,
    currentZipName = "archive.zip";

on(dzV, "click", () => inV.click());
on(dzV, "dragenter", () => dzV.classList.add("drag"));
on(dzV, "dragleave", () => dzV.classList.remove("drag"));
on(dzV, "drop", (e) => {
  dzV.classList.remove("drag");
  const file = e.dataTransfer?.files?.[0];
  if (file && /\.zip$/i.test(file.name)) {
    openZip(file);
  }
});
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
    metaV.textContent = `Loading ${file.name}…`;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    currentZip = zip;
    currentZipName = file.name;

    const entries = Object.keys(zip.files).sort();
    listV.innerHTML = entries.map(path => {
      const entry = zip.files[path];
      const label = entry.dir ? `[Folder] ${path}` : path;
      const right = entry.dir ? "—" : "open ▶";
      return `<div class="item file" data-path="${path}">
                <div class="name" title="${path}">${label}</div>
                <div class="meta">${right}</div>
              </div>`;
    }).join("");
    metaV.textContent = `${entries.length} entries in ${file.name}`;

    // Двойной клик по файлу в списке – открыть файл в новой вкладке
    $$(".item.file", listV).forEach(el =>
      on(el, "dblclick", async () => {
        const path = el.getAttribute("data-path");
        const entry = currentZip.file(path);
        if (!entry) return; // игнорируем клики на папки
        const arrayBuffer = await entry.async("arraybuffer");
        const blob = new Blob([arrayBuffer], { type: extMime(path) });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");              // открываем файл во вкладке браузера
        setTimeout(() => URL.revokeObjectURL(url), 10000);  // освобождаем URL спустя 10 сек
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
  // Базовая папка для извлечения: Downloads/ZIPboost_extract/[archive_name]
  const base = `ZIPboost_extract/${currentZipName.replace(/\.zip$/i, "")}`;
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
  metaV.textContent = `Extracted ${count} file(s) to Downloads/${base}`;
});
// ============================================================================
//                              LOCAL AUTH TAB
// ============================================================================

const accAuthed = $("#account-authed"),
      accAuth   = $("#account-auth"),
      accMsg    = $("#acc-msg");
const userInfo = $("#user-info"),
      btnOut   = $("#btn-logout");
const fLogin = $("#form-login"),
      fReg   = $("#form-register");

// Функции для хеширования пароля
async function sha256b64(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function makeSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a));
}
async function getUsers() {
  const { users } = await storageGet(["users"]);
  return users || {};
}
async function setUsers(u) {
  await storageSet({ users: u });
}

// Обновление UI сессии в разделе Account
async function refreshSessionUI() {
  const { sessionEmail } = await storageGet(["sessionEmail"]);
  if (sessionEmail) {
    const users = await getUsers();
    const u = users[sessionEmail];
    accAuthed.style.display = "block";
    accAuth.style.display   = "none";
    const until = u?.subUntil ? new Date(u.subUntil).toLocaleDateString() : "n/a";
    userInfo.textContent = `${sessionEmail} • subscription until ${until}`;
  } else {
    accAuthed.style.display = "none";
    accAuth.style.display   = "grid";
  }
}
refreshSessionUI();

// Logout
on(btnOut, "click", async () => {
  await storageSet({ sessionEmail: null });
  accMsg.textContent = "Logged out.";
  refreshSessionUI();
});

// Registration form submit
on(fReg, "submit", async (e) => {
  e.preventDefault();
  const email = $("#reg-email").value.trim().toLowerCase();
  const pass  = $("#reg-pass").value;
  if (!email || !pass) return;
  const users = await getUsers();
  if (users[email]) {
    accMsg.textContent = "Email already registered.";
    return;
  }
  const salt = makeSalt();
  const hash = await sha256b64(salt + pass);
  const until = Date.now() + 1000 * 60 * 60 * 24 * 365 * 5; // +5 years subscription
  users[email] = { salt, hash, subUntil: until };
  await setUsers(users);
  await storageSet({ sessionEmail: email });
  accMsg.textContent = "Account created. Logged in.";
  refreshSessionUI();
});

// Login form submit
on(fLogin, "submit", async (e) => {
  e.preventDefault();
  const email = $("#login-email").value.trim().toLowerCase();
  const pass  = $("#login-pass").value;
  const users = await getUsers();
  const u = users[email];
  if (!u) {
    accMsg.textContent = "No such user.";
    return;
  }
  const h = await sha256b64(u.salt + pass);
  if (h !== u.hash) {
    accMsg.textContent = "Wrong password.";
    return;
  }
  if ((u.subUntil || 0) < Date.now()) {
    accMsg.textContent = "Subscription inactive/expired.";
    return;
  }
  await storageSet({ sessionEmail: email });
  accMsg.textContent = "Logged in.";
  refreshSessionUI();
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
