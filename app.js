// Блокируем дефолтное поведение DnD, чтобы файлы не открывались во вкладках
["dragover","drop"].forEach(ev=>window.addEventListener(ev,e=>e.preventDefault(),{capture:true}));

const $ = s => document.querySelector(s);

// Tabs
const secC = $("#sec-compress"), secV = $("#sec-view");
const tabC = $("#tab-compress"), tabV = $("#tab-view");
function activate(which){
  [secC,secV].forEach(s=>s.classList.remove("active"));
  [tabC,tabV].forEach(t=>t.classList.remove("active"));
  if (which==="c"){secC.classList.add("active");tabC.classList.add("active");}
  else {secV.classList.add("active");tabV.classList.add("active");}
}
tabC.onclick = ()=>activate("c");
tabV.onclick = ()=>activate("v");

// Lib check
const libStatus = $("#lib-status");
function jszipReady(){ try{ const t=new JSZip(); return typeof t.generateAsync==="function"; }catch{return false;} }
if (!jszipReady()) libStatus.textContent = "JSZip is missing. Put REAL libs/jszip.min.js";

// Utils
const fmt = b => b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(1)} KB`:b<1073741824?`${(b/1048576).toFixed(1)} MB`:`${(b/1073741824).toFixed(1)} GB`;
const escapeHtml = s => s.replace(/[&<>\"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));

// ===== COMPRESS =====
const dzC=$("#dz-compress"), inpC=$("#inp-compress"), listC=$("#list-compress");
const zipName=$("#zip-name"), preset=$("#zip-preset"), btn=$("#btn-compress"), progress=$("#progress");
let files=[];

["dragenter","dragover"].forEach(e=>dzC.addEventListener(e,ev=>{ev.preventDefault();dzC.classList.add("drag");}));
["dragleave","drop"].forEach(e=>dzC.addEventListener(e,ev=>{ev.preventDefault();dzC.classList.remove("drag");}));
dzC.addEventListener("click", ()=>inpC.click());
inpC.addEventListener("change", ()=>{ if (inpC.files?.length){ files=[...inpC.files]; renderList(); } });
dzC.addEventListener("drop", async ev=>{
  const dt=ev.dataTransfer;
  if (dt?.files?.length){ files=[...dt.files]; renderList(); return; }
  const url=dt?.getData("URL")||dt?.getData("text/uri-list")||dt?.getData("text/plain");
  if (url){
    const r = await new Promise(res=>chrome.runtime.sendMessage({type:"FETCH_FILE", url}, res));
    if (r?.ok){
      const u8=new Uint8Array(r.buffer);
      const blob=new Blob([u8],{type:r.mime});
      const f=new File([blob], r.name || "file", { type: blob.type });
      files=[...files, f]; renderList();
    } else alert("Failed to fetch dropped URL");
  }
});

function renderList(){
  if (!files.length){ listC.innerHTML=""; return; }
  listC.innerHTML = files.map(f=>`
    <div class="item">
      <div class="name">${escapeHtml(f.name)}</div>
      <div class="meta">${fmt(f.size)}</div>
    </div>`).join("");
}

btn.addEventListener("click", async ()=>{
  if (!jszipReady()) return alert("JSZip not found (libs/jszip.min.js).");
  if (!files.length) return alert("Select files first.");
  let level=6; if (preset.value==="quick") level=1; else if (preset.value==="maximum") level=9;

  btn.disabled = true; const btnOld = btn.textContent; btn.textContent="Compressing…";
  progress.textContent = "Preparing…";
  try{
    const zip = new JSZip();
    for (const f of files) {
      const buf = await f.arrayBuffer();
      zip.file(f.name, buf);
    }
    const blob = await zip.generateAsync(
      {type:"blob", compression:"DEFLATE", compressionOptions:{level}},
      meta => { if (meta?.percent!=null) progress.textContent = `Compressing… ${Math.round(meta.percent)}%`; }
    );
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download = (zipName.value||"archive.zip").replace(/\.zip$/i,"") + ".zip";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 3000);
    progress.textContent="ZIP saved.";
  } catch(e){
    console.error(e); alert("ZIP generation failed.");
    progress.textContent="Failed.";
  } finally {
    btn.disabled=false; btn.textContent=btnOld;
  }
});

// ===== VIEW / EXTRACT =====
const dzV=$("#dz-view"), inpV=$("#inp-zip"), meta=$("#zip-meta"), listV=$("#list-zip"), btnExtractAll=$("#btn-extract-all");
let currentZip=null;

["dragenter","dragover"].forEach(e=>dzV.addEventListener(e,ev=>{ev.preventDefault();dzV.classList.add("drag");}));
["dragleave","drop"].forEach(e=>dzV.addEventListener(e,ev=>{ev.preventDefault();dzV.classList.remove("drag");}));
dzV.addEventListener("click", ()=>inpV.click());
dzV.addEventListener("drop", ev=>{ const f=ev.dataTransfer?.files?.[0]; if(f) openZip(f); });
inpV.addEventListener("change", ()=>{ const f=inpV.files?.[0]; if(f) openZip(f); });

async function openZip(file){
  if (!/\.zip$/i.test(file.name)) return alert("Please drop a .zip");
  if (!jszipReady()) return alert("JSZip not found.");
  try{
    const buf = await file.arrayBuffer();
    currentZip = await JSZip.loadAsync(buf);
    meta.textContent = `Archive: ${file.name} (${fmt(file.size)})`;
    const entries = Object.entries(currentZip.files);
    listV.innerHTML = entries.map(([p,e])=>{
      if (e.dir) return `<div class="item"><div class="name">[Folder] ${escapeHtml(p)}</div><div class="meta">—</div></div>`;
      return `<div class="item file" data-path="${escapeHtml(p)}"><div class="name">${escapeHtml(p)}</div><div class="meta">open ▶</div></div>`;
    }).join("");

    listV.querySelectorAll(".item.file").forEach(el=>{
      el.addEventListener("click", async ()=>{
        const path = el.getAttribute("data-path");
        const entry = currentZip.file(path); if (!entry) return;
        const blob = await entry.async("blob"); // preview/download depending on MIME sniff
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(()=>URL.revokeObjectURL(url), 10000);
      });
    });
  } catch(e){ console.error(e); alert("Unable to read ZIP (maybe corrupted)."); }
}

btnExtractAll.addEventListener("click", async ()=>{
  if (!currentZip) return alert("Open a ZIP first.");
  const entries = Object.entries(currentZip.files).filter(([_,e])=>!e.dir);
  if (!entries.length) return alert("Nothing to extract.");
  for (const [path, entry] of entries){
    try {
      const blob = await entry.async("blob");
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({
        url,
        filename: `ZIPboost_extract/${path}`, // Chrome сам создаст подпапки
        saveAs: false
      }, () => setTimeout(()=>URL.revokeObjectURL(url), 30000));
    } catch (e) {
      console.error("Extract error:", path, e);
    }
  }
});
