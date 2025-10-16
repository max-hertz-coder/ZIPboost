["dragover", "drop"].forEach(ev =>
  window.addEventListener(ev, e => e.preventDefault(), { capture: true })
);

const $ = s => document.querySelector(s);
const secC = $("#sec-compress"), secV = $("#sec-view");
const tabC = $("#tab-compress"), tabV = $("#tab-view");

function activate(section) {
  [secC, secV].forEach(s => s.classList.remove("active"));
  [tabC, tabV].forEach(t => t.classList.remove("active"));
  if (section === "c") { secC.classList.add("active"); tabC.classList.add("active"); }
  else { secV.classList.add("active"); tabV.classList.add("active"); }
}
tabC.onclick = () => activate("c");
tabV.onclick = () => activate("v");

const libStatus = $("#lib-status");
function jszipReady() {
  try { const t = new JSZip(); return typeof t.generateAsync === "function"; }
  catch { return false; }
}
if (!jszipReady()) libStatus.textContent = "JSZip missing — place real libs/jszip.min.js";

const fmt = b =>
  b < 1024 ? `${b} B` :
  b < 1048576 ? `${(b / 1024).toFixed(1)} KB` :
  b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` :
  `${(b / 1073741824).toFixed(1)} GB`;

const escapeHTML = s => s.replace(/[&<>\"']/g, m => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[m]));

// === COMPRESS ===
const dzC = $("#dz-compress"), inC = $("#inp-compress"),
      listC = $("#list-compress"), zipName = $("#zip-name"),
      preset = $("#zip-preset"), btn = $("#btn-compress"),
      prog = $("#progress");

let files = [];

["dragenter", "dragover"].forEach(e =>
  dzC.addEventListener(e, ev => { ev.preventDefault(); dzC.classList.add("drag"); })
);
["dragleave", "drop"].forEach(e =>
  dzC.addEventListener(e, ev => { ev.preventDefault(); dzC.classList.remove("drag"); })
);
dzC.onclick = () => inC.click();
inC.onchange = () => { if (inC.files?.length) { files = [...inC.files]; renderList(); } };

dzC.addEventListener("drop", async ev => {
  const dt = ev.dataTransfer;
  if (dt?.files?.length) { files = [...dt.files]; renderList(); return; }
  const url = dt?.getData("URL") || dt?.getData("text/plain");
  if (url) {
    const r = await new Promise(res => chrome.runtime.sendMessage({ type: "FETCH_FILE", url }, res));
    if (r?.ok) {
      const blob = new Blob([new Uint8Array(r.buffer)], { type: r.mime });
      const f = new File([blob], r.name, { type: blob.type });
      files.push(f);
      renderList();
    } else alert("Failed to fetch dropped URL");
  }
});

function renderList() {
  listC.innerHTML = files.map(f =>
    `<div class="item"><div class="name">${escapeHTML(f.name)}</div><div class="meta">${fmt(f.size)}</div></div>`
  ).join("");
}

btn.onclick = async () => {
  if (!jszipReady()) return alert("JSZip missing");
  if (!files.length) return alert("Select files first");
  let lvl = preset.value === "quick" ? 1 : preset.value === "maximum" ? 9 : 6;
  btn.disabled = true; const old = btn.textContent; btn.textContent = "Compressing...";
  try {
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, await f.arrayBuffer());
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: lvl } },
      meta => meta?.percent && (prog.textContent = `Compressing… ${Math.round(meta.percent)}%`));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = zipName.value.replace(/\.zip$/i, "") + ".zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    prog.textContent = "ZIP saved!";
  } catch (e) { alert("ZIP failed: " + e.message); }
  finally { btn.disabled = false; btn.textContent = old; }
};

// === VIEW ===
const dzV = $("#dz-view"), inV = $("#inp-zip"),
      meta = $("#zip-meta"), listV = $("#list-zip"),
      extractAll = $("#btn-extract-all");
let currentZip = null;

["dragenter", "dragover"].forEach(e => dzV.addEventListener(e, ev => { ev.preventDefault(); dzV.classList.add("drag"); }));
["dragleave", "drop"].forEach(e => dzV.addEventListener(e, ev => { ev.preventDefault(); dzV.classList.remove("drag"); }));
dzV.onclick = () => inV.click();
inV.onchange = () => { if (inV.files?.[0]) openZip(inV.files[0]); };
dzV.addEventListener("drop", e => { const f = e.dataTransfer?.files?.[0]; if (f) openZip(f); });

async function openZip(file) {
  if (!/\.zip$/i.test(file.name)) return alert("Not a ZIP");
  if (!jszipReady()) return alert("JSZip missing");
  try {
    currentZip = await JSZip.loadAsync(await file.arrayBuffer());
    meta.textContent = `Archive: ${file.name} (${fmt(file.size)})`;
    listV.innerHTML = Object.keys(currentZip.files).map(p => {
      const e = currentZip.files[p];
      return `<div class="item file" data-path="${escapeHTML(p)}">
        <div class="name">${e.dir ? "[Folder] " + escapeHTML(p) : escapeHTML(p)}</div>
        <div class="meta">${e.dir ? "—" : "open ▶"}</div></div>`;
    }).join("");
    listV.querySelectorAll(".item.file").forEach(el => el.onclick = async () => {
      const path = el.dataset.path, entry = currentZip.file(path);
      if (!entry) return;
      const blob = await entry.async("blob");
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  } catch (e) { alert("Failed to open ZIP: " + e.message); }
}

extractAll.onclick = async () => {
  if (!currentZip) return alert("No archive loaded");
  for (const [name, entry] of Object.entries(currentZip.files)) {
    if (entry.dir) continue;
    const blob = await entry.async("blob");
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: `ZIPboost_extract/${name}`, saveAs: false });
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  alert("All files extracted to Downloads/ZIPboost_extract/");
};
