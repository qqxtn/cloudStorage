const DEFAULT_SPACE = "\u9ed8\u8ba4\u7a7a\u95f4";

const fileInput = document.querySelector("#fileInput");
const chooseButton = document.querySelector("#chooseButton");
const refreshButton = document.querySelector("#refreshButton");
const dropZone = document.querySelector("#dropZone");
const fileList = document.querySelector("#fileList");
const emptyState = document.querySelector("#emptyState");
const statusText = document.querySelector("#statusText");
const fileCount = document.querySelector("#fileCount");
const totalSize = document.querySelector("#totalSize");
const spaceSelect = document.querySelector("#spaceSelect");
const spaceForm = document.querySelector("#spaceForm");
const spaceInput = document.querySelector("#spaceInput");
const currentSpace = document.querySelector("#currentSpace");
const pageTitle = document.querySelector("#pageTitle");
const uploadHint = document.querySelector("#uploadHint");
const spacePath = document.querySelector("#spacePath");
const uploadProgress = document.querySelector("#uploadProgress");
const progressLabel = document.querySelector("#progressLabel");
const progressPercent = document.querySelector("#progressPercent");
const progressBar = document.querySelector("#progressBar");

let activeSpace = localStorage.getItem("activeSpace") || DEFAULT_SPACE;
let isUploading = false;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    };
    return map[char];
  });
}

function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function fileBadge(name) {
  const extension = name.includes(".") ? name.split(".").pop().slice(0, 4).toUpperCase() : "FILE";
  return extension || "FILE";
}

function setStatus(message) {
  statusText.textContent = message;
}

function setProgress(percent, label) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  uploadProgress.classList.add("is-visible");
  uploadProgress.setAttribute("aria-hidden", "false");
  progressBar.style.width = `${safePercent}%`;
  progressPercent.textContent = `${safePercent}%`;
  progressLabel.textContent = label;
}

function resetProgress() {
  progressBar.style.width = "0%";
  progressPercent.textContent = "0%";
  progressLabel.textContent = "\u51c6\u5907\u4e0a\u4f20";
  uploadProgress.classList.remove("is-visible");
  uploadProgress.setAttribute("aria-hidden", "true");
}

function setActiveSpace(space) {
  activeSpace = space || DEFAULT_SPACE;
  localStorage.setItem("activeSpace", activeSpace);
  currentSpace.textContent = activeSpace;
  pageTitle.textContent = `${activeSpace} \u6587\u4ef6\u7a7a\u95f4`;
  uploadHint.textContent = `\u6587\u4ef6\u5c06\u4e0a\u4f20\u5230\u201c${activeSpace}\u201d\u3002`;
  spacePath.textContent = `uploads/${activeSpace}`;
}

function renderSpaces(spaces) {
  const names = spaces.map((space) => space.name);
  if (!names.includes(activeSpace)) {
    activeSpace = names[0] || DEFAULT_SPACE;
  }

  spaceSelect.innerHTML = "";
  for (const space of spaces) {
    const option = document.createElement("option");
    option.value = space.name;
    option.textContent = `${space.name}\uff08${space.fileCount}\uff09`;
    option.selected = space.name === activeSpace;
    spaceSelect.appendChild(option);
  }

  setActiveSpace(activeSpace);
}

function renderFiles(files) {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  fileCount.textContent = `${files.length} \u4e2a\u6587\u4ef6`;
  totalSize.textContent = formatSize(total);
  emptyState.classList.toggle("is-hidden", files.length > 0);
  fileList.innerHTML = "";

  for (const file of files) {
    const item = document.createElement("li");
    const safeName = escapeHtml(file.name);
    const downloadUrl = `/files?space=${encodeURIComponent(activeSpace)}&name=${encodeURIComponent(file.name)}`;

    item.className = "file-item";
    item.innerHTML = `
      <div class="file-main">
        <span class="file-type" aria-hidden="true">${escapeHtml(fileBadge(file.name))}</span>
        <div class="file-info">
          <span class="file-name" title="${safeName}">${safeName}</span>
          <span class="file-meta">${formatSize(file.size)} · ${formatDate(file.modifiedAt)}</span>
        </div>
      </div>
      <div class="file-actions">
        <a class="text-button" href="${downloadUrl}">\u4e0b\u8f7d</a>
        <button class="text-button danger" data-delete="${safeName}" type="button">\u5220\u9664</button>
      </div>
    `;
    fileList.appendChild(item);
  }
}

async function loadSpaces() {
  const response = await fetch("/api/spaces");
  const data = await response.json();
  renderSpaces(data.spaces || []);
}

async function loadFiles() {
  setStatus("\u6b63\u5728\u5237\u65b0...");
  const response = await fetch(`/api/files?space=${encodeURIComponent(activeSpace)}`);
  const data = await response.json();
  renderFiles(data.files || []);
  setStatus("\u51c6\u5907\u5c31\u7eea");
}

async function refreshAll() {
  await loadSpaces();
  await loadFiles();
}

function uploadFileWithProgress(file, fileIndex, fileTotal, completedBytes, totalBytes) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastProgressAt = Date.now();
    let reachedUploadEnd = false;
    const slowTimer = window.setInterval(() => {
      if (reachedUploadEnd || Date.now() - lastProgressAt < 4000) return;
      progressLabel.textContent = "\u4ecd\u5728\u4e0a\u4f20\uff0c\u8bf7\u4e0d\u8981\u5173\u95ed\u9875\u9762";
    }, 1000);

    function finish() {
      window.clearInterval(slowTimer);
    }

    xhr.open("POST", `/api/upload?space=${encodeURIComponent(activeSpace)}`);
    xhr.responseType = "json";
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");

    xhr.upload.addEventListener("progress", (event) => {
      lastProgressAt = Date.now();
      if (!event.lengthComputable) {
        setProgress(5, "\u6b63\u5728\u4e0a\u4f20...");
        return;
      }

      const percent = Math.min(((completedBytes + event.loaded) / totalBytes) * 100, 99);
      setProgress(percent, `\u6b63\u5728\u4e0a\u4f20 ${fileIndex + 1}/${fileTotal}\uff1a${file.name}`);
    });

    xhr.upload.addEventListener("load", () => {
      reachedUploadEnd = true;
      const percent = Math.min(((completedBytes + file.size) / totalBytes) * 100, 99);
      setProgress(percent, "\u89c6\u9891\u5df2\u53d1\u9001\uff0c\u670d\u52a1\u5668\u6b63\u5728\u5199\u5165\u78c1\u76d8...");
    });

    xhr.addEventListener("load", () => {
      finish();
      const data = xhr.response || {};
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data.error || "\u4e0a\u4f20\u5931\u8d25"));
        return;
      }
      resolve(data);
    });

    xhr.addEventListener("error", () => {
      finish();
      reject(new Error("\u7f51\u7edc\u9519\u8bef\uff0c\u4e0a\u4f20\u5931\u8d25"));
    });
    xhr.addEventListener("abort", () => {
      finish();
      reject(new Error("\u4e0a\u4f20\u5df2\u53d6\u6d88"));
    });
    xhr.send(file);
  });
}

async function uploadFiles(files) {
  if (!files.length || isUploading) return;

  isUploading = true;
  chooseButton.disabled = true;
  spaceSelect.disabled = true;
  setStatus(`\u6b63\u5728\u4e0a\u4f20 ${files.length} \u4e2a\u6587\u4ef6...`);
  setProgress(0, "\u6b63\u5728\u51c6\u5907\u4e0a\u4f20");

  try {
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || 1;
    let completedBytes = 0;
    let data = null;

    for (const [index, file] of files.entries()) {
      data = await uploadFileWithProgress(file, index, files.length, completedBytes, totalBytes);
      completedBytes += file.size;
      renderSpaces(data.spaces || []);
      renderFiles(data.files || []);
    }

    setProgress(100, "\u4e0a\u4f20\u5b8c\u6210");
    setStatus(`\u5df2\u4e0a\u4f20 ${files.length} \u4e2a\u6587\u4ef6`);
    window.setTimeout(resetProgress, 1200);
  } finally {
    isUploading = false;
    chooseButton.disabled = false;
    spaceSelect.disabled = false;
  }
}

spaceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = spaceInput.value.trim();
  if (!name) return;

  setStatus("\u6b63\u5728\u65b0\u5efa\u7a7a\u95f4...");
  const response = await fetch("/api/spaces", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ name })
  });
  const data = await response.json();

  if (!response.ok) {
    setStatus(data.error || "\u65b0\u5efa\u7a7a\u95f4\u5931\u8d25");
    return;
  }

  spaceInput.value = "";
  setActiveSpace(data.space);
  renderSpaces(data.spaces || []);
  await loadFiles();
  setStatus("\u7a7a\u95f4\u5df2\u521b\u5efa");
});

spaceSelect.addEventListener("change", async () => {
  setActiveSpace(spaceSelect.value);
  await loadFiles();
});

chooseButton.addEventListener("click", () => fileInput.click());

dropZone.addEventListener("click", (event) => {
  if (event.target === chooseButton || isUploading) return;
  fileInput.click();
});

fileInput.addEventListener("change", async () => {
  try {
    await uploadFiles([...fileInput.files]);
  } catch (error) {
    setStatus(error.message);
    resetProgress();
  } finally {
    fileInput.value = "";
  }
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
}

dropZone.addEventListener("drop", async (event) => {
  try {
    await uploadFiles([...event.dataTransfer.files]);
  } catch (error) {
    setStatus(error.message);
    resetProgress();
  }
});

refreshButton.addEventListener("click", () => {
  refreshAll().catch((error) => setStatus(error.message));
});

fileList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;

  const name = button.dataset.delete;
  if (!confirm(`\u5220\u9664 ${name}\uff1f`)) return;

  setStatus("\u6b63\u5728\u5220\u9664...");
  const response = await fetch(
    `/api/files?space=${encodeURIComponent(activeSpace)}&name=${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );
  const data = await response.json();

  if (!response.ok) {
    setStatus(data.error || "\u5220\u9664\u5931\u8d25");
    return;
  }

  renderSpaces(data.spaces || []);
  renderFiles(data.files || []);
  setStatus("\u5df2\u5220\u9664");
});

refreshAll().catch((error) => setStatus(error.message));
