// Main client-side JavaScript for ZBoost
// Handles file compression, zip file preview, and displaying user info.

document.addEventListener('DOMContentLoaded', () => {
    // Elements from the DOM
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    const fileTable = document.getElementById('file-table');
    const levelSelect = document.getElementById('level-select');
    const compressBtn = document.getElementById('compress-btn');
    const zipFileInput = document.getElementById('zip-file-input');
    const zipDropZone = document.getElementById('zip-drop-zone');
    const zipTable = document.getElementById('zip-table');
    const userEmailSpan = document.getElementById('user-email');
    const subUntilSpan = document.getElementById('sub-until');
    
    let filesToCompress = [];   // Array of File objects selected for compression
    let zipEntries = [];        // Array of {name, size, blob} for entries in a loaded zip
  
    // Utility: format bytes into KB/MB/GB strings
    function formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
  
    // Utility: guess MIME type from file extension (for preview)
    function getMimeType(filename) {
      const ext = filename.split('.').pop().toLowerCase();
      const mimeTypes = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'pdf': 'application/pdf',
        'txt': 'text/plain',
        'html': 'text/html',
        'js': 'text/javascript',
        'css': 'text/css',
        'json': 'application/json'
        // add more types if needed
      };
      return mimeTypes[ext] || 'application/octet-stream';
    }
  
    // Fetch user session info to display email and subscription date
    fetch('/session')
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => {
        userEmailSpan.textContent = data.email;
        subUntilSpan.textContent = new Date(data.subUntil).toLocaleDateString();
      })
      .catch(() => {
        // If session is invalid (e.g., expired), redirect to login
        window.location.href = '/login';
      });
  
    // File selection via clicking the drop zone (compression)
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        filesToCompress = Array.from(fileInput.files);
        renderFileList();
      }
    });
    // Drag & drop for compression files
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        filesToCompress = Array.from(e.dataTransfer.files);
        renderFileList();
      }
    });
  
    // Render the list of files to compress
    function renderFileList() {
      fileTable.innerHTML = '';  // clear current list
      filesToCompress.forEach(file => {
        const row = document.createElement('tr');
        const nameCell = document.createElement('td');
        nameCell.textContent = file.name;
        const sizeCell = document.createElement('td');
        sizeCell.textContent = formatSize(file.size);
        const typeCell = document.createElement('td');
        typeCell.textContent = file.type || '(unknown)';
        const removeCell = document.createElement('td');
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
          // Remove this file from the list and re-render
          filesToCompress = filesToCompress.filter(f => f !== file);
          renderFileList();
        });
        removeCell.appendChild(removeBtn);
        row.appendChild(nameCell);
        row.appendChild(sizeCell);
        row.appendChild(typeCell);
        row.appendChild(removeCell);
        fileTable.appendChild(row);
      });
    }
  
    // Handle the "Compress to ZIP" button
    compressBtn.addEventListener('click', async () => {
      if (filesToCompress.length === 0) {
        alert('No files selected for compression.');
        return;
      }
      // Determine numeric compression level
      let level;
      switch (levelSelect.value) {
        case 'quick':    level = 1; break;
        case 'optimal':  level = 6; break;
        case 'maximum':  level = 9; break;
        default:         level = 6;
      }
      compressBtn.disabled = true;
      compressBtn.textContent = 'Compressing...';
      try {
        const zip = new JSZip();
        // Add each file to the archive
        filesToCompress.forEach(file => {
          zip.file(file.name, file);  // JSZip will read the File object content
        });
        // Generate the zip file blob with the specified compression level
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: level } });
        // Trigger file download for the generated ZIP
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ZBoost_archive.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke the object URL after a short delay to free memory
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        alert('Error compressing files: ' + err);
        console.error('Compression error:', err);
      } finally {
        compressBtn.disabled = false;
        compressBtn.textContent = 'Compress to ZIP';
      }
    });
  
    // File selection via clicking the drop zone (ZIP extraction)
    zipDropZone.addEventListener('click', () => zipFileInput.click());
    zipFileInput.addEventListener('change', () => {
      if (zipFileInput.files.length > 0) {
        const zipFile = zipFileInput.files[0];
        loadZipFile(zipFile);
      }
    });
    // Drag & drop for zip file
    zipDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zipDropZone.classList.add('drag-over');
    });
    zipDropZone.addEventListener('dragleave', () => {
      zipDropZone.classList.remove('drag-over');
    });
    zipDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      zipDropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        const zipFile = e.dataTransfer.files[0];
        if (zipFile.name.toLowerCase().endsWith('.zip')) {
          loadZipFile(zipFile);
        } else {
          alert('Please drop a .zip file.');
        }
      }
    });
  
    // Load and parse a ZIP file, then display its contents
    async function loadZipFile(file) {
      zipTable.innerHTML = '<tr><td>Loading ZIP content...</td></tr>';
      zipEntries = [];
      try {
        const zip = await JSZip.loadAsync(file);  // read the zip file
        const fileNames = Object.keys(zip.files);
        for (const fileName of fileNames) {
          const entry = zip.files[fileName];
          if (!entry.dir) {  // skip directories
            // Get uncompressed content as ArrayBuffer
            const content = await entry.async('arraybuffer');
            const blob = new Blob([content], { type: getMimeType(fileName) });
            zipEntries.push({ name: fileName, size: blob.size, blob: blob });
          }
        }
        // Display the list of files in the ZIP
        zipTable.innerHTML = '';
        zipEntries.forEach((entry, index) => {
          const row = document.createElement('tr');
          const nameCell = document.createElement('td');
          nameCell.textContent = entry.name;
          const sizeCell = document.createElement('td');
          sizeCell.textContent = formatSize(entry.size);
          const actionCell = document.createElement('td');
          const viewBtn = document.createElement('button');
          viewBtn.textContent = 'View/Open';
          viewBtn.addEventListener('click', () => {
            const url = URL.createObjectURL(entry.blob);
            window.open(url, '_blank');
            // We could revoke the URL after some time, but not immediately to allow viewing
            // setTimeout(() => URL.revokeObjectURL(url), 5000);
          });
          actionCell.appendChild(viewBtn);
          row.appendChild(nameCell);
          row.appendChild(sizeCell);
          row.appendChild(actionCell);
          zipTable.appendChild(row);
        });
        if (zipEntries.length === 0) {
          zipTable.innerHTML = '<tr><td>This ZIP archive is empty.</td></tr>';
        }
      } catch (err) {
        zipTable.innerHTML = '<tr><td>Error reading ZIP file.</td></tr>';
        console.error('Failed to load zip file:', err);
      }
    }
  });
  