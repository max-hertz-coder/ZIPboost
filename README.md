# ZIPboost

<p align="center">
  <img src="https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Extension">
  <img src="https://img.shields.io/badge/Frontend-Shared%20Popup%20%2B%20Web%20UI-7C3AED?style=for-the-badge" alt="Shared UI">
  <img src="https://img.shields.io/badge/ZIP-JSZip-16A34A?style=for-the-badge" alt="JSZip">
  <img src="https://img.shields.io/badge/RAR%20%7C%207Z%20%7C%20TAR-libarchive.js-F59E0B?style=for-the-badge" alt="libarchive.js">
  <img src="https://img.shields.io/badge/Privacy-Client--Side%20Processing-111827?style=for-the-badge" alt="Client-side processing">
</p>

<p align="center">
  <b>ZIPboost</b> is a browser-first archive utility that lets users create ZIP files, inspect archive contents, and extract selected files directly from a Chrome extension popup or from a lightweight local web app.
</p>

<p align="center">
  <a href="https://github.com/max-hertz-coder/ZIPboost">Repository</a>
  ·
  <a href="https://chromewebstore.google.com/detail/create-zip-file/holbdgggpngcjloephdibcobkojceehj">Chrome Web Store</a>
  ·
  <a href="https://max-hertz-coder.github.io/zipboost-welcome_page/">Welcome Page</a>
</p>

---

## Table of contents

- [Overview](#overview)
- [Why ZIPboost exists](#why-zipboost-exists)
- [Core features](#core-features)
- [Supported formats](#supported-formats)
- [How the project is structured](#how-the-project-is-structured)
- [Architecture](#architecture)
- [How compression works](#how-compression-works)
- [How archive viewing and extraction work](#how-archive-viewing-and-extraction-work)
- [Download pipeline and Manifest V3 strategy](#download-pipeline-and-manifest-v3-strategy)
- [State management, themes, and UX details](#state-management-themes-and-ux-details)
- [Local web app mode](#local-web-app-mode)
- [Quick start](#quick-start)
- [Usage flows](#usage-flows)
- [Key implementation decisions](#key-implementation-decisions)
- [Important code snippets](#important-code-snippets)
- [Security and privacy notes](#security-and-privacy-notes)
- [Known limitations](#known-limitations)
- [Roadmap ideas](#roadmap-ideas)
- [Tech stack](#tech-stack)
- [References](#references)

---

## Overview

ZIPboost is built around one simple idea: **archive operations should feel as lightweight as opening a browser tab**.

Instead of forcing users to install desktop archivers for quick everyday tasks, ZIPboost provides a compact interface for three common workflows:

1. **Create a ZIP archive from selected files**
2. **Open an archive and inspect its contents**
3. **Download either the whole extracted set or only specific files**

The repository contains two closely related delivery modes:

- a **Chrome extension** powered by **Manifest V3**
- a **local web app** served by a minimal Express server

Both modes reuse the same main UI and most of the same frontend logic.

---

## Why ZIPboost exists

Many archive tools are powerful, but a large portion of real-world usage is much simpler:

- bundle a few files into one ZIP before sending them
- quickly inspect what is inside an archive without leaving the browser
- extract only one file instead of unpacking everything
- keep the workflow local and fast
- avoid extra native desktop tools for small repetitive tasks

ZIPboost targets exactly this use case. The project is intentionally browser-centric, with a popup-sized UI that focuses on:

- low interaction cost
- clear drag-and-drop workflow
- local archive handling
- fast download actions
- practical multi-format support for archive reading

---

## Core features

### 1. ZIP creation directly in the popup

Users can drag and drop files or select them manually, then generate a `.zip` archive from the selected set.

### 2. Archive inspection before extraction

The extension can show archive entries as a list so the user can understand what is inside before downloading anything.

### 3. Selective extraction

Instead of always unpacking the entire archive, users can download a single file or a filtered subset.

### 4. Multi-format archive reading

The project supports:

- **ZIP** using **JSZip**
- **RAR / 7Z / TAR / TGZ** using **libarchive.js** when bundled

### 5. Shared UI across extension and local app

The popup UI is also usable in a local browser context through a tiny Express server.

### 6. Dark/light theme toggle

The interface persists theme choice in local extension storage.

### 7. Popup state persistence

The current tab and some UI state are saved in `chrome.storage.local`, which makes the popup more resilient between openings.

### 8. Download handling through the service worker

Downloads are initiated via the background service worker to make the workflow more reliable in Manifest V3.

### 9. Noise-file filtering

The extraction pipeline intentionally skips common OS-generated junk files such as:

- `__MACOSX/`
- `._*`
- `.DS_Store`
- `Thumbs.db`

That keeps the visible archive list cleaner and avoids unnecessary user confusion.

---

## Supported formats

### Archive creation

At the moment, ZIPboost **creates ZIP archives**.

### Archive reading / extraction

ZIPboost can **open and extract** the following formats:

- `.zip`
- `.rar`
- `.7z`
- `.tar`
- `.tar.gz`
- `.tgz`

### Compression strategy

The creation pipeline uses a **hybrid rule**:

- already-compressed file types are added with **STORE** (no additional compression)
- most other file types are added with **DEFLATE level 1**

This is a deliberate speed-first strategy explained below.

---

## How the project is structured

```text
ZIPboost/
├── background.js                # MV3 service worker: install events, downloads, fetch proxy
├── manifest.json                # Chrome extension manifest
├── package.json                 # Node metadata and dependencies
├── server.js                    # Minimal Express server for local web mode
├── public/
│   ├── main.js                  # Main popup/web app logic
│   └── style.css                # Glassmorphism UI styles
├── views/
│   └── app.html                 # Shared UI entry point
├── libs/
│   ├── jszip.min.js             # ZIP creation and ZIP reading
│   └── libarchive/
│       ├── libarchive.js        # Multi-format archive support
│       └── worker-bundle.js     # Worker used by libarchive.js
└── icons/
    └── ...                      # Extension icons
```

---

## Architecture

```text
                    ┌───────────────────────────────┐
                    │         User interaction      │
                    │ drag & drop / file picker     │
                    └──────────────┬────────────────┘
                                   │
                                   ▼
                    ┌───────────────────────────────┐
                    │        views/app.html         │
                    │    shared popup / web UI      │
                    └──────────────┬────────────────┘
                                   │
                                   ▼
                    ┌───────────────────────────────┐
                    │         public/main.js        │
                    │ tabs, theme, archive logic,   │
                    │ ZIP create, open, extract     │
                    └───────┬───────────┬──────────┘
                            │           │
            ZIP create/read │           │ RAR/7Z/TAR read
                            │           │
                            ▼           ▼
                    ┌─────────────┐   ┌────────────────┐
                    │   JSZip     │   │ libarchive.js  │
                    └─────────────┘   └────────────────┘
                            │           │
                            └─────┬─────┘
                                  ▼
                    ┌───────────────────────────────┐
                    │         background.js         │
                    │ service worker + downloads    │
                    └──────────────┬────────────────┘
                                   │
                                   ▼
                    ┌───────────────────────────────┐
                    │       Chrome downloads        │
                    └───────────────────────────────┘
```

### High-level split of responsibilities

#### `manifest.json`
Defines the extension as **Manifest V3**, registers the popup, permissions, and service worker.

#### `views/app.html`
Provides the actual UI layout: tabs, drop zones, action buttons, archive list, rating widget, and script/style includes.

#### `public/main.js`
Contains almost all interactive behavior:

- tabs
- theme switching
- state save/restore
- file selection for compression
- ZIP generation
- archive opening
- extraction
- MIME handling
- warnings for browser restrictions

#### `background.js`
Handles background-only tasks:

- welcome page on installation
- reliable downloads via `chrome.downloads`
- binary download from raw byte arrays
- interruption notifications
- optional fetch proxy helper

#### `server.js`
Only serves static files for a local browser-based demo/dev mode. It is **not** involved in archive processing itself.

---

## How compression works

The ZIP creation pipeline is implemented in `public/main.js` using **JSZip**.

### Input model

The app collects files through:

- drag and drop
- `<input type="file" multiple>`

Selected files are stored in an in-memory array:

```js
let filesToCompress = [];
```

### Naming

The output archive name is taken from the text input and sanitized:

- path separators are replaced
- illegal filename characters are normalized to `_`

### Compression policy

The logic intentionally distinguishes between **compressible** and **already-compressed** file types.

#### Stored without compression
Examples:

- images: `jpg`, `png`, `webp`, `gif`
- video: `mp4`, `mkv`, `webm`
- audio: `mp3`, `flac`, `ogg`
- archives: `zip`, `rar`, `7z`, `gz`, `xz`
- already-compressed office formats: `docx`, `xlsx`, `pptx`
- `pdf`

For these files, ZIPboost uses:

```js
compression: "STORE"
```

That avoids wasting CPU cycles for little or no size gain.

#### Compressed with DEFLATE level 1

For more compressible inputs, ZIPboost uses:

```js
compression: "DEFLATE",
compressionOptions: { level: 1 }
```

The choice of **level 1** is deliberate:

- faster archive creation
- better popup responsiveness
- good enough size reduction for typical quick-use scenarios

This project prioritizes **speed and responsiveness** over the smallest possible archive.

### Final generation

The archive is produced with:

```js
zip.generateAsync({
  type: 'blob',
  streamFiles: true
});
```

This returns a Blob that is then passed to the download subsystem.

---

## How archive viewing and extraction work

ZIPboost supports two extraction routes depending on format.

### A. ZIP path via JSZip

When the selected file name ends with `.zip`, the app:

1. reads the file as `ArrayBuffer`
2. loads it with `JSZip.loadAsync(...)`
3. enumerates `currentZipJS.files`
4. filters out system junk files
5. renders the archive entry list
6. allows one-file download or full extraction

This path is ideal for standard ZIP files because it is lightweight and purely JavaScript-based.

### B. RAR / 7Z / TAR path via libarchive.js

For `.rar`, `.7z`, `.tar`, `.tgz`, or `.tar.gz`, the app uses **libarchive.js** if the bundled worker is available.

The typical flow is:

1. initialize `Archive` with the worker bundle
2. open the archive
3. get a file map or extract files
4. convert extracted output to `File`
5. trigger download through the background service worker

This gives ZIPboost broader read support without requiring a native archiver.

### Why two archive engines?

Because the formats have different tradeoffs:

- **JSZip** is excellent for ZIP creation and ZIP reading
- **libarchive.js** broadens archive compatibility for viewing and extraction

This split keeps the ZIP path simple and the multi-format path flexible.

---

## Download pipeline and Manifest V3 strategy

Manifest V3 changes the way extension background logic works. Traditional persistent background pages are replaced by a **service worker**.

ZIPboost follows that model:

- popup logic runs in the extension page
- download execution is forwarded to the service worker
- the service worker calls `chrome.downloads.download(...)`

### Why not always download directly from the popup?

Because extension popups are short-lived and some download scenarios are more reliable when delegated to the background context.

ZIPboost therefore sends messages such as:

- `download`
- `downloadBlob`
- `FETCH_URL`

to `background.js`.

### `downloadBlob` flow

This is the most important reliability layer in the project.

Instead of relying only on a transient `blob:` URL generated in the popup, ZIPboost can:

1. convert a Blob/File into `ArrayBuffer`
2. pack it into a byte array
3. send it to the background service worker
4. reconstruct the Blob in that context
5. create a fresh object URL there
6. call `chrome.downloads.download(...)`

This is a solid MV3-compatible design for handling generated files.

### Download interruption handling

The service worker also listens to:

```js
chrome.downloads.onChanged
```

If a download is interrupted, it sends a runtime message back to the popup so the UI can show user-facing instructions.

### Browser restrictions explicitly acknowledged by the UI

The popup warns users about issues such as:

- blocked automatic downloads
- “ask where to save each file”
- ad blockers interfering with `blob:` downloads

That is a strong UX decision: instead of silently failing, ZIPboost tries to explain what happened.

---

## State management, themes, and UX details

ZIPboost is more than a compression script; it is a small product with several quality-of-life improvements.

### 1. Tab persistence

The active tab (`compress` or `view`) is saved in `chrome.storage.local`.

### 2. Archive name persistence

The ZIP name field is saved as part of popup state.

### 3. Theme persistence

Dark/light mode is saved in local storage and restored on load.

### 4. Cleanup of volatile buffers

When the popup is hidden, ZIPboost clears temporary in-memory buffers such as:

- current archive reference
- queued downloads
- selected compress files

That helps keep the popup lightweight.

### 5. Filtering of system artifacts

The `isSystemFile(...)` helper prevents common hidden OS artifacts from polluting the archive list.

### 6. Size display helpers

The UI includes byte/KB/MB/GB formatting to make archive entries readable.

### 7. Glassmorphism UI

The CSS is intentionally polished:

- translucent panels
- blurred surfaces
- gradient background
- dark/light theme variables
- compact popup-first spacing

This makes the extension feel product-like instead of purely utilitarian.

---

## Local web app mode

ZIPboost can also run outside the extension as a local web app.

### What `server.js` actually does

The server is intentionally minimal:

- serves static files from the repository root
- serves `views/app.html` at `/`

That means the frontend is still doing the real work. The backend does **not** compress files, parse archives, or store user data.

### Why keep a local web mode?

It is useful for:

- UI development
- testing outside the extension loader
- debugging styles and interactions
- demonstrating the interface in a normal browser tab

This mode also keeps the project easier to iterate on during development.

---

## Quick start

## 1. Clone the repository

```bash
git clone https://github.com/max-hertz-coder/ZIPboost.git
cd ZIPboost
```

## 2. Install dependencies

```bash
npm install
```

## 3. Run as a local web app

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## 4. Load as a Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the project folder
5. Pin the extension if desired
6. Open the popup and test archive creation/viewing

---

## Usage flows

### Create a ZIP archive

1. Open the popup
2. Stay on the **Compress** tab
3. Drag files into the drop zone or click to select them
4. Optionally edit the output name
5. Click **Create Zip File**
6. The generated archive is downloaded automatically

### Inspect an existing archive

1. Open the **View** tab
2. Drop a `.zip`, `.rar`, `.7z`, `.tar`, `.tar.gz`, or `.tgz` file
3. ZIPboost lists available entries
4. The list is filtered to remove common junk/system files

### Extract a single file

1. Open an archive
2. Find the target item
3. Click the download icon on that file

### Extract all visible files

1. Open an archive
2. Leave only the files you want in the queue
3. Click **Download all**

### Clear popup state

Use **Clear** to remove the current archive/session state stored in the popup context.

---

## Key implementation decisions

## 1. Shared frontend between extension and web app

This reduces duplication and keeps UI behavior consistent across both delivery modes.

## 2. JSZip for ZIP generation

ZIP creation is the main write operation in the app. JSZip is a natural fit because it is browser-friendly and easy to integrate into a popup workflow.

## 3. libarchive.js for broader read support

Instead of limiting the project to ZIP-only inspection, libarchive.js enables a better archive reader experience for additional formats.

## 4. Speed-first compression policy

The app does **not** try to win maximum compression benchmarks. Instead, it optimizes for a fast practical UX:

- STORE for already-compressed inputs
- DEFLATE level 1 for the rest

## 5. Service-worker-based download handling

This aligns with Manifest V3 architecture and improves reliability compared with popup-only download logic.

## 6. Extension-preserving MIME fallback

Binary downloads are frequently forced to:

```text
application/octet-stream
```

This is a practical way to reduce the risk of Chrome altering extensions or sniffing content in unwanted ways.

## 7. Explicit user guidance for blocked downloads

Many small tools fail silently when browser download settings interfere. ZIPboost takes the opposite approach and shows actionable instructions.

---

## Important code snippets

### Smart compression selection

```js
if (isPreCompressed(f.name)) {
  zip.file(f.name, f, { compression: "STORE" });
} else {
  zip.file(f.name, f, {
    compression: "DEFLATE",
    compressionOptions: { level: 1 }
  });
}
```

**Why it matters:** this is one of the most important design choices in the project. It balances performance with meaningful compression.

---

### ZIP generation

```js
const blob = await zip.generateAsync({
  type: 'blob',
  streamFiles: true
});
```

**Why it matters:** generation happens completely in-browser and produces a downloadable Blob without requiring server-side archiving.

---

### Manifest V3 background worker

```json
"background": {
  "service_worker": "background.js",
  "type": "module"
}
```

**Why it matters:** ZIPboost follows the current Chrome extension model instead of legacy background pages.

---

### Download via background service worker

```js
chrome.downloads.download(
  { url, filename, conflictAction: 'uniquify', saveAs: false },
  (id) => {
    const lastError = chrome.runtime.lastError?.message;
    sendResponse({ ok: !!id, id, lastError });
  }
);
```

**Why it matters:** download execution is delegated to the background context, improving reliability in popup workflows.

---

### System file filtering

```js
function isSystemFile(path) {
  const name = path.split('/').pop();
  return path.startsWith('__MACOSX/') ||
         path.includes('/__MACOSX/') ||
         name.startsWith('._') ||
         name === '.DS_Store' ||
         name === 'Thumbs.db';
}
```

**Why it matters:** this prevents clutter and improves user trust in what they actually see and extract.

---

### MIME strategy to preserve binary extensions

```js
const extMime = (name) => {
  const ext = (name.split(".").pop() || "").toLowerCase();

  const textMimes = {
    txt:"text/plain",
    md:"text/markdown",
    html:"text/html",
    json:"application/json"
  };

  if (textMimes[ext]) return textMimes[ext];
  return "application/octet-stream";
};
```

**Why it matters:** the project intentionally treats most binary outputs as octet-stream to reduce risky browser-side guessing.

---

## Security and privacy notes

ZIPboost is architected so that archive processing itself happens on the **client side**:

- JSZip runs in the frontend
- libarchive.js runs in the browser context with its worker
- the service worker handles downloads
- the local Express server only serves static files

That means the repository code does **not** require a backend upload pipeline for core archive operations.

### Permissions rationale

The manifest requests these key permissions:

- `downloads` — required to save generated and extracted files
- `storage` — required for popup state and theme persistence
- `unlimitedStorage` — useful for browser-side handling of archive-related state and data
- `host_permissions: <all_urls>` — broad allowance, likely intended to support flexible resource access and future fetch-based workflows

### Important nuance

The UI currently includes a Localize bootstrap script in `app.html`, so the interface layer can involve an external localization resource depending on deployment context. That is separate from the archive-processing pipeline itself.

---

## Known limitations

1. **ZIP creation only**  
   The current write path creates ZIP archives only.

2. **Multi-format read path depends on bundled libarchive assets**  
   If `libs/libarchive/*` is missing or not initialized correctly, advanced formats will not work.

3. **Large archives are still constrained by browser memory**  
   This is a browser tool, not a native streaming archiver for huge enterprise datasets.

4. **No directory selection workflow in the main create flow**  
   The current file input is file-based rather than folder-tree-oriented.

5. **Download UX can still be affected by browser policy**  
   Settings like blocked multiple downloads or “ask where to save each file” can interrupt bulk extraction.

6. **Popup lifetime constraints still exist**  
   The project mitigates these with state persistence and background downloads, but extension popups are inherently ephemeral.

7. **Localization architecture can be consolidated further**  
   The repo uses manifest i18n placeholders and also includes a UI localization bootstrap, so this part can be simplified or unified later.

---

## Roadmap ideas

Possible next improvements:

- directory/folder input support for ZIP creation
- compression presets in the UI (speed / balanced / max)
- drag-and-drop reordering before compression
- archive search/filter inside the file list
- progress bars for large extraction jobs
- password-protected archive support where feasible
- richer error reporting for unsupported or corrupted archives
- automated tests for create/open/extract flows
- screenshot/demo section in the README
- formal license file

---

## Tech stack

- **Chrome Extension Manifest V3**
- **JavaScript**
- **Express**
- **JSZip**
- **libarchive.js**
- **Chrome Downloads API**
- **Chrome Storage API**
- **CSS with glassmorphism-style theming**

---

## References

This project is grounded in a mix of repository code decisions and the following official or upstream resources:

### Chrome extension platform
- Chrome Extensions Manifest V3 migration guide  
  https://developer.chrome.com/docs/extensions/develop/migrate
- Extension service worker basics  
  https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics
- Chrome Downloads API  
  https://developer.chrome.com/docs/extensions/reference/api/downloads

### Archive libraries
- JSZip documentation — `generateAsync()`  
  https://stuk.github.io/jszip/documentation/api_jszip/generate_async.html
- libarchive project homepage  
  https://www.libarchive.org/
- libarchive GitHub repository  
  https://github.com/libarchive/libarchive

### Distribution / product page
- Chrome Web Store listing for the published extension  
  https://chromewebstore.google.com/detail/create-zip-file/holbdgggpngcjloephdibcobkojceehj

---

## Final note

ZIPboost is not trying to replace every full-featured desktop archiver.  
Its strength is different:

> **fast, local, browser-native archive work for the most common day-to-day scenarios**

That focus explains almost every architectural choice in the repository:

- popup-sized UX
- JSZip for fast ZIP creation
- libarchive.js for broader archive reading
- MV3 service worker for downloads
- state persistence for a smoother popup experience
- practical heuristics over overly complex compression tuning

If you want a compact archive utility that feels natural inside Chrome, ZIPboost is built exactly for that job.
