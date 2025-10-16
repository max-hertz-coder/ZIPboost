// ======================= ZIPboost (MV3 popup) =======================
// Полностью автономный попап: DnD, сжатие, просмотр, распаковка,
// локальный аккаунт (chrome.storage.local), сохранение настроек.

// ---------------- UI helpers ----------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const on = (el, evt, fn, opts) => el.addEventListener(evt, fn, opts);

// Разделы и вкладки
const secC = $("#sec-compress"), secV = $("#sec-view"), secA = $("#sec-account");
const tabC = $("#tab-compress"),   tabV = $("#tab-view"),   tabA = $("#tab-account");
function activate(section, tab) {
  [secC, secV, secA].forEach(s => s.classList.remove("active"));
  [tabC, tabV, tabA].forEach(t => t.classList.remove("active"));
  section.classList.add("active"); tab.classList.add("active");
}
on(tabC, "click", () => activate(secC, tabC));
on(tabV, "click", () => activate(secV, tabV));
on(tabA, "click", () => activate(secA, tabA));

// Можно навигировать по hash: #compress | #view | #account
(function routeByHash() {
  const h = (location.hash || "").toLowerCase();
  if (h.includes("view")) activate(secV, tabV);
  else if (h.includes("account")) activate(secA, tabA);
  else activate(secC, tabC);
})();

// Глобально глушим дефолт, чтобы файлы/URL не открывались новой вкладкой
["dragover", "drop"].forEach(evt => {
  window.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }, true);
});

// ---------------- Lib / статус ----------------
const libStatus = $("#lib-status");
let JSZIP_OK = false;
try { JSZIP_OK = typeof (new JSZip()).generateAsync === "function"; } catch { JSZIP_OK = false; }
if (!JSZIP_OK) libStatus.textContent = "JSZip is missing. Put real libs/jszip.min.js.";

// ---------------- Общие утилиты ----------------
const fmt = b => b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(1)} KB`:b<1073741824?`${(b/1048576).toFixed(1)} MB`:`${(b/1073741824).toFixed(1)} GB`;
const sanitizeName = s => (s || "archive.zip").replace(/[/\\:*?"<>|]/g, "_");
const extMime = (name) => {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const m = {png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",svg:"image/svg+xml",
             pdf:"application/pdf",txt:"text/plain",md:"text/markdown",html:"text/html",css:"text/css",js:"text/javascript",
             json:"application/json",csv:"text/csv"};
  return m[ext] || "application/octet-stream";
};
const storageGet = (keys) => new Promise(r => chrome.storage.local.get(keys, r));
const storageSet = (obj)  => new Promise(r => chrome.storage.local.set(obj, r));

// ---------------- COMPRESS ----------------
const dzC = $("#dz-compress"), inC = $("#inp-compress"), listC = $("#list-compress");
const zipName = $("#zip-name"), preset = $("#zip-preset"), btnZip = $("#btn-compress"), progC = $("#progress");
let files = [];

// восстановим настройки
(async () => {
  const { lastZipName, lastPreset } = await storageGet(["lastZipName","lastPreset"]);
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
      <div class="name">${f.name}</div>
      <div class="meta">${fmt(f.size)}</div>
      <button class="secondary xs" data-i="${i}" title="Remove">✕</button>
    </div>
  `).join("");
  // remove buttons
  $$(".item button[data-i]", listC).forEach(btn => on(btn, "click", () => {
    const idx = Number(btn.getAttribute("data-i"));
    if (!Number.isNaN(idx)) { files.splice(idx,1); renderCompressList(); }
  }));
}

// дроп файлов
on(dzC, "click", () => inC.click());
on(dzC, "dragenter", () => dzC.classList.add("drag"));
on(dzC, "dragleave", () => dzC.classList.remove("drag"));
on(dzC, "drop", async (e) => {
  dzC.classList.remove("drag");
  const dt = e.dataTransfer;
  // 1) файлы
  if (dt?.files?.length) {
    files.push(...Array.from(dt.files));
    renderCompressList();
    return;
  }
  // 2) URL (если перетащили ссылку/изображение со страницы)
  const url = dt?.getData("URL") || dt?.getData("text/uri-list") || dt?.getData("text/plain");
  if (url) {
    await tryAddUrlAsFile(url);
    return;
  }
});

on(inC, "change", () => {
  if (inC.files?.length) files.push(...Array.from(inC.files));
  inC.value = ""; renderCompressList();
});

// загрузка файла по URL через SW (требует host_permissions: <all_urls>)
async function fetchViaSW(url) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "FETCH_URL", url }, resolve);
  });
}
// попытаться добавить URL как файл (если прав нет — скажем пользователю)
async function tryAddUrlAsFile(url) {
  try {
    const r = await fetchViaSW(url);
    if (r?.ok && r.buffer) {
      const u8 = new Uint8Array(r.buffer);
      const blob = new Blob([u8], { type: r.mime || "application/octet-stream" });
      const name = r.name || (new URL(url)).pathname.split("/").pop() || "file";
      files.push(new File([blob], name, { type: blob.type }));
      renderCompressList();
    } else {
      console.warn("FETCH_URL denied or failed:", r?.error);
      alert("To drag URLs, add host_permissions: \"<all_urls>\" in manifest.json.");
    }
  } catch (e) {
    console.warn("URL fetch error:", e);
    alert("Could not fetch dropped URL.");
  }
}

on(btnZip, "click", async () => {
  if (!JSZIP_OK) return alert("JSZip is not loaded.");
  if (!files.length) return alert("Add files first.");
  await storageSet({ lastZipName: zipName.value, lastPreset: preset.value });

  const lvl = preset.value === "quick" ? 1 : preset.value === "maximum" ? 9 : 6;
  const name = sanitizeName(zipName.value || "archive.zip");

  btnZip.disabled = true; progC.textContent = "Packing…";
  try {
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f);
    const blob = await zip.generateAsync(
      { type:"blob", compression:"DEFLATE", compressionOptions:{ level:lvl }, streamFiles:true },
      m => m?.percent!=null && (progC.textContent = `Packing… ${Math.round(m.percent)}%`)
    );
    const url = URL.createObjectURL(blob);
    chrome.runtime.sendMessage(
      { type:"download", payload:{ url, filename:name } },
      (res) => {
        setTimeout(()=>URL.revokeObjectURL(url), 3000);
        if (!res?.ok) console.warn("download error:", res?.lastError);
        progC.textContent = res?.ok ? "Saved to Downloads." : "Saved (fallback)";
      }
    );
  } catch (e) {
    console.error(e); alert("Compression failed: " + e.message);
  } finally {
    btnZip.disabled = false;
  }
});

// ---------------- VIEW / EXTRACT ----------------
const dzV = $("#dz-view"), inV = $("#inp-zip"), listV = $("#list-zip"), metaV = $("#zip-meta"), btnExtract = $("#btn-extract-all");
let currentZip = null, currentZipName = "archive.zip";

on(dzV, "click", () => inV.click());
on(dzV, "dragenter", () => dzV.classList.add("drag"));
on(dzV, "dragleave", () => dzV.classList.remove("drag"));
on(dzV, "drop", (e) => {
  dzV.classList.remove("drag");
  const f = e.dataTransfer?.files?.[0];
  if (f && /\.zip$/i.test(f.name)) openZip(f);
});

on(inV, "change", () => { const f = inV.files?.[0]; if (f) openZip(f); });

async function openZip(file) {
  if (!JSZIP_OK) return alert("JSZip is not loaded.");
  try {
    metaV.textContent = `Loading ${file.name}…`;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    currentZip = zip; currentZipName = file.name;

    const entries = Object.keys(zip.files).sort();
    listV.innerHTML = entries.map(p => {
      const e = zip.files[p];
      const label = e.dir ? `[Folder] ${p}` : p;
      const right  = e.dir ? "—" : "open ▶";
      return `<div class="item file" data-path="${p}">
                <div class="name">${label}</div>
                <div class="meta">${right}</div>
              </div>`;
    }).join("");
    metaV.textContent = `${entries.length} entries in ${file.name}`;

    // двойной клик = открыть
    $$(".item.file", listV).forEach(el => on(el, "dblclick", async ()=>{
      const path = el.getAttribute("data-path");
      const entry = currentZip.file(path);
      if (!entry) return;
      const arr = await entry.async("arraybuffer");
      const blob = new Blob([arr], { type: extMime(path) });
      const url  = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(()=>URL.revokeObjectURL(url), 10000);
    }));
  } catch (e) {
    console.error(e); alert("Unable to read ZIP (maybe corrupted).");
  }
}

on(btnExtract, "click", async () => {
  if (!currentZip) return alert("Open a ZIP first.");
  const base = `ZIPboost_extract/${currentZipName.replace(/\.zip$/i, "")}`;
  const entries = Object.entries(currentZip.files);
  let count = 0;

  for (const [name, entry] of entries) {
    if (entry.dir) continue;
    try {
      const arr  = await entry.async("arraybuffer");
      const blob = new Blob([arr], { type: extMime(name) });
      const url  = URL.createObjectURL(blob);
      // ZIP имена могут содержать обратные слэши — нормализуем
      const safe = name.split("\\").join("/");
      chrome.runtime.sendMessage({ type:"download", payload:{ url, filename:`${base}/${safe}` } },
        () => setTimeout(()=>URL.revokeObjectURL(url), 3000)
      );
      count++;
    } catch (e) {
      console.warn("Extract failed:", name, e);
    }
  }
  metaV.textContent = `Extracted ${count} file(s) to Downloads/${base}`;
});

// ---------------- Local Auth (внутри расширения) ----------------
// users: { [email]: { salt, hash, subUntil } }, sessionEmail: string|null
const accAuthed = $("#account-authed"), accAuth = $("#account-auth"), accMsg = $("#acc-msg");
const userInfo  = $("#user-info"),     btnOut  = $("#btn-logout");
const fLogin    = $("#form-login"),    fReg    = $("#form-register");

async function sha256b64(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function makeSalt() { const a=new Uint8Array(16); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)); }
async function getUsers() { const {users} = await storageGet(["users"]); return users || {}; }
async function setUsers(u){ await storageSet({users:u}); }

async function refreshSessionUI() {
  const { sessionEmail } = await storageGet(["sessionEmail"]);
  if (sessionEmail) {
    const u = (await getUsers())[sessionEmail];
    accAuthed.style.display = "block"; accAuth.style.display = "none";
    const until = u?.subUntil ? new Date(u.subUntil).toLocaleDateString() : "n/a";
    userInfo.textContent = `${sessionEmail} • subscription until ${until}`;
  } else {
    accAuthed.style.display = "none"; accAuth.style.display = "grid";
  }
}
refreshSessionUI();

on(btnOut, "click", async ()=>{ await storageSet({sessionEmail:null}); accMsg.textContent="Logged out."; refreshSessionUI(); });

on(fReg, "submit", async (e)=>{
  e.preventDefault();
  const email = $("#reg-email").value.trim().toLowerCase();
  const pass  = $("#reg-pass").value;
  if (!email || !pass) return;
  const users = await getUsers();
  if (users[email]) { accMsg.textContent="Email already registered."; return; }
  const salt = makeSalt(), hash = await sha256b64(salt + pass);
  const until = Date.now() + 1000*60*60*24*365*5; // +5 лет «активна»
  users[email] = { salt, hash, subUntil: until };
  await setUsers(users); await storageSet({ sessionEmail: email });
  accMsg.textContent="Account created. Logged in."; refreshSessionUI();
});

on(fLogin, "submit", async (e)=>{
  e.preventDefault();
  const email = $("#login-email").value.trim().toLowerCase();
  const pass  = $("#login-pass").value;
  const users = await getUsers();
  const u = users[email];
  if (!u) { accMsg.textContent="No such user."; return; }
  const h = await sha256b64(u.salt + pass);
  if (h !== u.hash) { accMsg.textContent="Wrong password."; return; }
  if ((u.subUntil||0) < Date.now()) { accMsg.textContent="Subscription inactive/expired."; return; }
  await storageSet({ sessionEmail: email });
  accMsg.textContent="Logged in."; refreshSessionUI();
});

// ---------------- Подсказка по правам для URL DnD ----------------
(async ()=>{
  try {
    // Проверка — есть ли у нас вообще хост-права
    const perms = await chrome.permissions?.getAll?.();
    const hasAllUrls = perms?.origins?.some?.(o => o === "<all_urls>");
    if (!hasAllUrls) {
      // Покажем мягкую подсказку только в секции Compress
      const hint = document.createElement("div");
      hint.className = "meta";
      hint.style.marginTop = "6px";
      hint.innerHTML = `Tip: to drag <b>links/images from web pages</b>, add
        <code>host_permissions: ["&lt;all_urls&gt;"]</code> and handle FETCH_URL in background.js.`;
      dzC.insertAdjacentElement("afterend", hint);
    }
  } catch {}
})();
