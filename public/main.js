// Главный скрипт для веб-версии ZIPboost (локальный режим)
// Обрабатывает Drag&Drop, сжатие и просмотр архивов

document.addEventListener('DOMContentLoaded', () => {
  // Элементы DOM
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

  let filesToCompress = [];   // Выбранные для сжатия файлы
  let zipEntries = [];        // Список файлов в загруженном архиве

  // Вспомогательная функция: формат размера в человекочитаемом виде
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  // Обработка Drag&Drop для сжатия (локальные файлы)
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
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      filesToCompress = Array.from(fileInput.files);
      renderFileList();
    }
  });

  function renderFileList() {
    fileTable.innerHTML = '';
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

  // Обработка кнопки "Compress"
  compressBtn.addEventListener('click', async () => {
    if (filesToCompress.length === 0) {
      alert('No files selected for compression.');
      return;
    }
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
      filesToCompress.forEach(file => {
        zip.file(file.name, file);
      });
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level }
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ZBoost_archive.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert('Error compressing files: ' + err);
      console.error('Compression error:', err);
    } finally {
      compressBtn.disabled = false;
      compressBtn.textContent = 'Compress to ZIP';
    }
  });

  // Drag & Drop для загрузки ZIP-файла (просмотр содержимого)
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
      loadZipFile(zipFile);
    }
  });
  zipDropZone.addEventListener('click', () => zipFileInput.click());
  zipFileInput.addEventListener('change', () => {
    if (zipFileInput.files.length > 0) {
      const zipFile = zipFileInput.files[0];
      loadZipFile(zipFile);
    }
  });

  async function loadZipFile(file) {
    if (!/\.zip$/i.test(file.name)) {
      alert("Please drop a .zip file");
      return;
    }
    const fr = new FileReader();
    fr.onerror = () => alert("Read error");
    fr.onload = async () => {
      try {
        currentZip = await JSZip.loadAsync(fr.result);
        renderZipList(file);
      } catch (e) {
        alert("Unable to read ZIP (maybe corrupted).");
      }
    };
    fr.readAsArrayBuffer(file);
  }

  function renderZipList(file) {
    zipMeta.textContent = `Archive: ${file.name} (${new Date(file.lastModified).toLocaleDateString()})`;
    const entries = Object.entries(currentZip.files);
    zipTable.innerHTML = ''; // таблица списков файлов
    entries.forEach(([path, entry]) => {
      if (!entry.dir) {
        const row = document.createElement('tr');
        const nameCell = document.createElement('td');
        nameCell.textContent = path;
        const sizeCell = document.createElement('td');
        sizeCell.textContent = formatSize(entry._data.uncompressedSize);
        const openCell = document.createElement('td');
        const openBtn = document.createElement('button');
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', async () => {
          const ext = path.split('.').pop().toLowerCase();
          if (["txt","md","csv","log","json","js","css"].includes(ext)) {
            const text = await entry.async("string");
            const w = window.open("", "_blank");
            if (w) w.document.body.innerHTML = `<pre>${text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`;
          } else if (["png","jpg","jpeg","gif","bmp","webp","svg"].includes(ext)) {
            const blob = await entry.async("blob");
            const url = URL.createObjectURL(blob);
            window.open(url, "_blank");
            setTimeout(()=>URL.revokeObjectURL(url), 5000);
          } else {
            // Другие типы не поддерживаются — скачать
            const blob = await entry.async("blob");
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = path;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(()=>URL.revokeObjectURL(url), 3000);
          }
        });
        openCell.appendChild(openBtn);
        const sizeCol = document.createElement('td');
        sizeCol.textContent = formatSize(entry._data.uncompressedSize);
        row.appendChild(nameCell);
        row.appendChild(sizeCol);
        row.appendChild(openCell);
        zipTable.appendChild(row);
      }
    });
  }
});
