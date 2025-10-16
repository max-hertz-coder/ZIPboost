// MV3 popup logic — все внутри попапа (без локалхоста)

// ---------- UI helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const secCompress = $("#sec-compress");
const secView     = $("#sec-view");
const secAccount  = $("#sec-account");
const tabs = {
  compress: $("#tab-compress"),
  view: $("#tab-view"),
  account: $("#tab-account")
};

function activate(section, tab) {
  [secCompress, secView, secAccount].forEach(s => s.classList.remove("active"));
  Object.values(tabs).forEach(t => t.classList.remove("active"));
  section.classList.add("active");
  tab.classList.add("active");
}

tabs.compress.addEventListener("click", () => activate(secCompress, tabs.compress));
tabs.view.addEventListener("click",     () => activate(secView, tabs.view));
tabs.account.addEventListener("click",  () => activate(secAccount, tabs.account));

// Глобально блокируем дефолтные drop-события, чтобы браузер не открывал файлы во вкладке
["dragover","drop"].forEach(evt => {
  window.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }, false);
});

// ---------- Lib checks ----------
const libStatus = $("#lib-status");
let JSZIP_OK = false;
try {
  const t = new JSZip();
  JSZIP_OK = typeof t.generateAsync === "function";
} catch { JSZIP_OK = false; }
if (!JSZIP_OK) {
  libStatus.textContent = "JSZip not found. Put real libs/jszip.min.js (download commands below).";
}

// ---------- Compression UI ----------
const dzCompress = $("#dz-compress");
const inpCompress = $("#inp-compress");
const listCompress = $("#list-compress");
const zipNameInput = $("#zip-name");
const presetSelect = $("#zip-preset");
const btnCompress = $("#btn-compress");
const progressEl = $("#progress");

let filesToZip = [];

function humanSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + " KB";
  if (bytes < 1024*1024*1024) return (bytes/1024/1024).toFixed(1) + " MB";
  return (bytes/1024/1024/1024).toFixed(1) + " GB";
}

function renderCompressList() {
  listCompress.innerHTML = "";
  if (filesToZip.length === 0) {
    listCompress.innerHTML = `<div class="meta" style="padding:10px">No files selected.</div>`;
    return;
  }
  filesToZip.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div class="name">${f.name}</div>
      <div class="meta">${humanSize(f.size)}</div>
    `;
    row.addEventListener("dblclick", () => { filesToZip.splice(i,1); renderCompressList(); });
    listCompress.appendChild(row);
  });
}

// клики/дропы
dzCompress.addEventListener("click", () => inpCompress.click());
dzCompress.addEventListener("dragover", () => dzCompress.classList.add("drag"));
dzCompress.addEventListener("dragleave", () => dzCompress.classList.remove("drag"));
dzCompress.addEventListener("drop", (e) => {
  dzCompress.classList.remove("drag");
  const files = Array.from(e.dataTransfer?.files || []);
  if (files.length) {
    filesToZip.push(...files);
    renderCompressList();
  }
});
inpCompress.addEventListener("change", () => {
  filesToZip.push(...Array.from(inpCompress.files || []));
  inpCompress.value = "";
  renderCompressList();
});

btnCompress.addEventListener("click", async () => {
  if (!JSZIP_OK) { alert("JSZip is not loaded. See instructions below."); return; }
  if (filesToZip.length === 0) { alert("Add files first."); return; }

  const filename = (zipNameInput.value || "archive.zip").replace(/[/\\:*?"<>|]/g, "_");
  const preset = presetSelect.value;
  const level = preset === "quick" ? 1 : preset === "maximum" ? 9 : 6;

  btnCompress.disabled = true;
  progressEl.textContent = "Packing…";

  try {
    const zip = new JSZip();
    filesToZip.forEach(f => zip.file(f.name, f));
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level },
      streamFiles: true
    }, (meta) => {
      progressEl.textContent = `Packing… ${Math.floor(meta.percent)}%`;
    });

    const url = URL.createObjectURL(blob);
    chrome.runtime.sendMessage(
      { type: "download", payload: { url, filename } },
      (res) => {
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        progressEl.textContent = res?.ok ? "Saved to Downloads." : `Save error: ${res?.lastError || "unknown"}`;
      }
    );
  } catch (e) {
    console.error(e);
    alert("Compression failed: " + e.message);
  } finally {
    btnCompress.disabled = false;
  }
});

// ---------- View / Extract ----------
const dzView = $("#dz-view");
const inpZip = $("#inp-zip");
const listZip = $("#list-zip");
const zipMeta = $("#zip-meta");
const btnExtractAll = $("#btn-extract-all");
let currentZip = null; // JSZip instance
let currentZipName = "archive.zip";

function mimeFromName(name) {
  const ext = name.split(".").pop().toLowerCase();
  const map = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml",
    pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
    html: "text/html", css: "text/css", js: "text/javascript",
    json: "application/json", csv: "text/csv"
  };
  return map[ext] || "application/octet-stream";
}

dzView.addEventListener("click", () => inpZip.click());
dzView.addEventListener("dragover", () => dzView.classList.add("drag"));
dzView.addEventListener("dragleave", () => dzView.classList.remove("drag"));
dzView.addEventListener("drop", (e) => {
  dzView.classList.remove("drag");
  const f = e.dataTransfer?.files?.[0];
  if (f && /\.zip$/i.test(f.name)) loadZip(f);
});
inpZip.addEventListener("change", () => {
  const f = inpZip.files?.[0];
  if (f) loadZip(f);
});

async function loadZip(file) {
  if (!JSZIP_OK) { alert("JSZip is not loaded. See instructions below."); return; }
  listZip.innerHTML = `<div class="meta" style="padding:10px">Loading ${file.name}…</div>`;
  zipMeta.textContent = "";
  currentZip = null;
  currentZipName = file.name;

  try {
    const zip = await JSZip.loadAsync(file);
    currentZip = zip;

    const names = Object.keys(zip.files).sort();
    listZip.innerHTML = "";
    let total = 0;

    for (const name of names) {
      const entry = zip.files[name];
      if (entry.dir) continue;

      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <div class="name">${name}</div>
        <div class="meta">double-click to open</div>
      `;
      row.addEventListener("dblclick", async () => {
        const arr = await entry.async("arraybuffer");
        const blob = new Blob([arr], { type: mimeFromName(name) });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        // Удалим позже — иначе вкладка не успеет прочитать
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
      listZip.appendChild(row);

      total += entry._data?.uncompressedSize || 0;
    }
    zipMeta.textContent = `${names.length} entries • ~${humanSize(total)} unpacked`;
  } catch (e) {
    console.error(e);
    listZip.innerHTML = `<div class="meta" style="padding:10px;color:#ff8a8a">Unable to read ZIP (maybe corrupted).</div>`;
  }
}

btnExtractAll.addEventListener("click", async () => {
  if (!currentZip) { alert("Open a ZIP first."); return; }
  const base = `ZIPboost_extract/${currentZipName.replace(/\.zip$/i,"")}`;
  const names = Object.keys(currentZip.files);
  let extracted = 0;

  for (const name of names) {
    const entry = currentZip.files[name];
    if (entry.dir) continue;
    try {
      const arr = await entry.async("arraybuffer");
      const blob = new Blob([arr], { type: mimeFromName(name) });
      const url = URL.createObjectURL(blob);
      // В именах ZIP могут быть подпапки — заменяем на «/»
      const safeName = name.split("\\").join("/");
      chrome.runtime.sendMessage(
        { type: "download", payload: { url, filename: `${base}/${safeName}` } },
        () => setTimeout(() => URL.revokeObjectURL(url), 2000)
      );
      extracted++;
    } catch (e) {
      console.warn("Extract failed for", name, e);
    }
  }
  zipMeta.textContent = `Extracted ${extracted} file(s) to Downloads/${base}`;
});

// ---------- Local auth (внутри расширения) ----------
/*
  Без сервера. Храним в chrome.storage.local:
  users: { [email]: { salt: base64, hash: base64, subUntil: number } }
  sessionEmail: string | null
*/

const accountAuthed = $("#account-authed");
const accountAuth   = $("#account-auth");
const userInfo      = $("#user-info");
const btnLogout     = $("#btn-logout");
const formLogin     = $("#form-login");
const formRegister  = $("#form-register");
const accMsg        = $("#acc-msg");

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

async function sha256Base64(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  const b = String.fromCharCode(...new Uint8Array(buf));
  return btoa(b);
}
function randomSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr));
}

async function getUsers() {
  const { users } = await storageGet(["users"]);
  return users || {};
}
async function setUsers(users) {
  await storageSet({ users });
}

async function refreshSessionUI() {
  const { sessionEmail } = await storageGet(["sessionEmail"]);
  if (sessionEmail) {
    const users = await getUsers();
    const u = users[sessionEmail];
    accountAuthed.style.display = "block";
    accountAuth.style.display = "none";
    if (u) {
      const until = new Date(u.subUntil || Date.now());
      userInfo.textContent = `${sessionEmail} • subscription until ${until.toLocaleDateString()}`;
    } else {
      userInfo.textContent = sessionEmail;
    }
  } else {
    accountAuthed.style.display = "none";
    accountAuth.style.display = "grid";
  }
}
refreshSessionUI();

btnLogout.addEventListener("click", async () => {
  await storageSet({ sessionEmail: null });
  accMsg.textContent = "Logged out.";
  refreshSessionUI();
});

formRegister.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#reg-email").value.trim().toLowerCase();
  const pass  = $("#reg-pass").value;
  if (!email || !pass) return;

  const users = await getUsers();
  if (users[email]) {
    accMsg.textContent = "Email is already registered.";
    return;
  }
  const salt = randomSalt();
  const hash = await sha256Base64(salt + pass);
  // Считай, что «подписка активна» на 5 лет вперёд
  const fiveYears = Date.now() + 1000*60*60*24*365*5;
  users[email] = { salt, hash, subUntil: fiveYears };
  await setUsers(users);
  await storageSet({ sessionEmail: email });
  accMsg.textContent = "Account created. You are logged in.";
  refreshSessionUI();
});

formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#login-email").value.trim().toLowerCase();
  const pass  = $("#login-pass").value;
  const users = await getUsers();
  const u = users[email];
  if (!u) { accMsg.textContent = "No such user."; return; }
  const hash = await sha256Base64(u.salt + pass);
  if (hash !== u.hash) { accMsg.textContent = "Wrong password."; return; }
  if ((u.subUntil || 0) < Date.now()) {
    accMsg.textContent = "Subscription inactive/expired (local flag).";
    return;
  }
  await storageSet({ sessionEmail: email });
  accMsg.textContent = "Logged in.";
  refreshSessionUI();
});
