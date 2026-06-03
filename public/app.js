const DEFAULT_SPACE = "\u516c\u5171\u7a7a\u95f4";
const LEGACY_DEFAULT_SPACE = "\u9ed8\u8ba4\u7a7a\u95f4";

const fileInput = document.querySelector("#fileInput");
const chooseButton = document.querySelector("#chooseButton");
const refreshButton = document.querySelector("#refreshButton");
const dropZone = document.querySelector("#dropZone");
const fileList = document.querySelector("#fileList");
const emptyState = document.querySelector("#emptyState");
const emptyTitle = document.querySelector("#emptyTitle");
const emptyText = document.querySelector("#emptyText");
const statusText = document.querySelector("#statusText");
const fileCount = document.querySelector("#fileCount");
const totalSize = document.querySelector("#totalSize");
const spaceType = document.querySelector("#spaceType");
const spaceSelect = document.querySelector("#spaceSelect");
const spaceAccessText = document.querySelector("#spaceAccessText");
const spaceLoginForm = document.querySelector("#spaceLoginForm");
const spacePasswordInput = document.querySelector("#spacePasswordInput");
const spaceForm = document.querySelector("#spaceForm");
const spaceInput = document.querySelector("#spaceInput");
const spaceVisibility = document.querySelector("#spaceVisibility");
const newSpacePasswordInput = document.querySelector("#newSpacePasswordInput");
const deleteSpaceButton = document.querySelector("#deleteSpaceButton");
const adminLoginForm = document.querySelector("#adminLoginForm");
const adminUserInput = document.querySelector("#adminUserInput");
const adminPasswordInput = document.querySelector("#adminPasswordInput");
const adminState = document.querySelector("#adminState");
const adminPanel = document.querySelector("#adminPanel");
const adminLogoutButton = document.querySelector("#adminLogoutButton");
const currentSpace = document.querySelector("#currentSpace");
const pageTitle = document.querySelector("#pageTitle");
const uploadHint = document.querySelector("#uploadHint");
const spacePath = document.querySelector("#spacePath");
const uploadProgress = document.querySelector("#uploadProgress");
const progressLabel = document.querySelector("#progressLabel");
const progressPercent = document.querySelector("#progressPercent");
const progressBar = document.querySelector("#progressBar");
const privateSpaceModal = document.querySelector("#privateSpaceModal");
const privateSpaceLoginForm = document.querySelector("#privateSpaceLoginForm");
const modalSpaceName = document.querySelector("#modalSpaceName");
const modalSpacePasswordInput = document.querySelector("#modalSpacePasswordInput");
const modalCloseButton = document.querySelector("#modalCloseButton");
const previewModal = document.querySelector("#previewModal");
const previewImage = document.querySelector("#previewImage");
const previewTitle = document.querySelector("#previewTitle");
const previewDownload = document.querySelector("#previewDownload");
const previewCloseButton = document.querySelector("#previewCloseButton");

let activeSpace = localStorage.getItem("activeSpace") || DEFAULT_SPACE;
if (activeSpace === LEGACY_DEFAULT_SPACE) activeSpace = DEFAULT_SPACE;
let adminToken = localStorage.getItem("adminToken") || "";
let adminLoggedIn = false;
let spaces = [];
let isUploading = false;
let firstLoad = true;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
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

function isPreviewableImage(name) {
  return /\.(apng|avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(name);
}

function fileUrl(name) {
  const params = new URLSearchParams({ space: activeSpace, name });
  const token = spaceToken(activeSpace);
  if (token) params.set("token", token);
  if (adminToken) params.set("adminToken", adminToken);
  return `/files?${params.toString()}`;
}

function showPreview(name) {
  const url = fileUrl(name);
  previewTitle.textContent = name;
  previewImage.alt = name;
  previewModal.querySelector(".preview-modal").style.removeProperty("--preview-width");
  previewModal.querySelector(".preview-modal").style.removeProperty("--preview-height");
  previewImage.src = url;
  previewDownload.href = url;
  previewDownload.download = name;
  previewModal.classList.remove("is-hidden");
}

function hidePreview() {
  previewModal.classList.add("is-hidden");
  previewImage.removeAttribute("src");
  previewDownload.removeAttribute("href");
  previewModal.querySelector(".preview-modal").style.removeProperty("--preview-width");
  previewModal.querySelector(".preview-modal").style.removeProperty("--preview-height");
}

function fitPreviewToImage() {
  if (previewModal.classList.contains("is-hidden")) return;
  const modal = previewModal.querySelector(".preview-modal");
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;

  if (viewportWidth <= 720) {
    modal.style.setProperty("--preview-width", `${Math.max(280, viewportWidth - 24)}px`);
    modal.style.setProperty("--preview-height", `${Math.max(180, viewportHeight - 188)}px`);
    return;
  }

  const maxImageWidth = Math.max(320, viewportWidth - 120);
  const maxImageHeight = Math.max(260, viewportHeight - 230);
  const naturalWidth = previewImage.naturalWidth || maxImageWidth;
  const naturalHeight = previewImage.naturalHeight || maxImageHeight;
  const scale = Math.min(1, maxImageWidth / naturalWidth, maxImageHeight / naturalHeight);
  const fittedWidth = Math.round(naturalWidth * scale);
  const fittedHeight = Math.round(naturalHeight * scale);

  modal.style.setProperty("--preview-width", `${Math.max(320, fittedWidth + 48)}px`);
  modal.style.setProperty("--preview-height", `${Math.max(240, fittedHeight + 2)}px`);
}

function headers(extra = {}) {
  return adminToken ? { ...extra, "x-admin-token": adminToken } : extra;
}

function spaceToken(space) {
  return sessionStorage.getItem(`spaceToken:${space}`) || "";
}

function authHeaders(space, extra = {}) {
  const token = spaceToken(space);
  const result = headers(extra);
  if (token) result["x-space-token"] = token;
  return result;
}

function currentMeta() {
  return spaces.find((space) => space.name === activeSpace);
}

function hasSpaceAccess(space) {
  const meta = spaces.find((item) => item.name === space);
  return !meta || meta.visibility === "public" || meta.unlocked || Boolean(spaceToken(space)) || adminLoggedIn;
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
  progressLabel.textContent = "准备上传";
  uploadProgress.classList.remove("is-visible");
  uploadProgress.setAttribute("aria-hidden", "true");
}

function showPrivateSpaceModal() {
  modalSpaceName.textContent = activeSpace;
  modalSpacePasswordInput.value = "";
  privateSpaceModal.classList.remove("is-hidden");
  window.setTimeout(() => modalSpacePasswordInput.focus(), 0);
}

function hidePrivateSpaceModal() {
  privateSpaceModal.classList.add("is-hidden");
  modalSpacePasswordInput.value = "";
}

function setActiveSpace(space) {
  activeSpace = space || DEFAULT_SPACE;
  localStorage.setItem("activeSpace", activeSpace);
  const meta = currentMeta();
  currentSpace.textContent = activeSpace;
  pageTitle.textContent = `${activeSpace} 文件空间`;
  spacePath.textContent = `uploads/${activeSpace}`;
  spaceType.textContent = meta?.visibility === "private" ? "私有" : "公有";
  uploadHint.textContent = `文件将上传到“${activeSpace}”。`;
  deleteSpaceButton.disabled = activeSpace === DEFAULT_SPACE;

  const locked = meta?.visibility === "private" && !hasSpaceAccess(activeSpace);
  spaceLoginForm.classList.add("is-hidden");
  chooseButton.disabled = locked;
  spaceAccessText.textContent = locked ? "私有空间，选择后需要密码登录。" : "当前空间可访问。";
  if (!locked) hidePrivateSpaceModal();
}

function setLockedView() {
  fileCount.textContent = "0 个文件";
  totalSize.textContent = "0 B";
  fileList.innerHTML = "";
  emptyState.classList.remove("is-hidden");
  emptyTitle.textContent = "私有空间已锁定";
  emptyText.textContent = "请输入空间密码，解锁后才能查看和上传文件。";
  setStatus("等待空间密码");
}

function renderSpaces(nextSpaces, options = {}) {
  spaces = nextSpaces;
  const names = spaces.map((space) => space.name);
  if (options.preferDefault && names.includes(DEFAULT_SPACE)) {
    activeSpace = DEFAULT_SPACE;
  } else if (!names.includes(activeSpace)) {
    activeSpace = names[0] || DEFAULT_SPACE;
  }

  spaceSelect.innerHTML = "";
  for (const space of spaces) {
    const option = document.createElement("option");
    option.value = space.name;
    option.textContent = `${space.name}（${space.visibility === "private" ? "私有" : "公有"}）`;
    option.selected = space.name === activeSpace;
    spaceSelect.appendChild(option);
  }

  setActiveSpace(activeSpace);
}

function renderAdmin(loggedIn, username) {
  adminLoggedIn = loggedIn;
  if (!loggedIn && adminToken) {
    adminToken = "";
    localStorage.removeItem("adminToken");
  }
  adminState.textContent = loggedIn ? `已登录：${username}` : "未登录";
  adminLoginForm.classList.toggle("is-hidden", loggedIn);
  adminLogoutButton.classList.toggle("is-hidden", !loggedIn);
  adminPanel.classList.toggle("is-hidden", !loggedIn);
}

function renderFiles(files) {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  fileCount.textContent = `${files.length} 个文件`;
  totalSize.textContent = formatSize(total);
  emptyState.classList.toggle("is-hidden", files.length > 0);
  emptyTitle.textContent = "当前空间还没有文件";
  emptyText.textContent = "上传后会在这里显示名称、大小和修改时间。";
  fileList.innerHTML = "";

  for (const file of files) {
    const item = document.createElement("li");
    const safeName = escapeHtml(file.name);
    const downloadUrl = `/files?space=${encodeURIComponent(activeSpace)}&name=${encodeURIComponent(file.name)}`;
    const previewButton = isPreviewableImage(file.name)
      ? `<button class="text-button" data-preview="${safeName}" type="button">预览</button>`
      : "";

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
        ${previewButton}
        <a class="text-button" href="${downloadUrl}" data-download="${safeName}">下载</a>
        <button class="text-button danger" data-delete="${safeName}" type="button">删除</button>
      </div>
    `;
    fileList.appendChild(item);
  }
}

async function loadSpaces() {
  const response = await fetch("/api/spaces", { headers: headers() });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "加载空间失败");
  renderAdmin(Boolean(data.admin?.loggedIn), data.admin?.username);
  renderSpaces(data.spaces || [], { preferDefault: firstLoad });
  firstLoad = false;
}

async function loadFiles() {
  setActiveSpace(activeSpace);
  if (!hasSpaceAccess(activeSpace)) {
    setLockedView();
    showPrivateSpaceModal();
    return;
  }

  setStatus("正在刷新...");
  const response = await fetch(`/api/files?space=${encodeURIComponent(activeSpace)}`, {
    headers: authHeaders(activeSpace)
  });
  const data = await response.json();
  if (response.status === 401) {
    sessionStorage.removeItem(`spaceToken:${activeSpace}`);
    setLockedView();
    showPrivateSpaceModal();
    return;
  }
  if (!response.ok) throw new Error(data.error || "加载文件失败");
  renderFiles(data.files || []);
  setStatus("准备就绪");
}

async function refreshAll(options = {}) {
  await loadSpaces();
  if (options.keepActiveSpace) {
    const names = spaces.map((space) => space.name);
    if (names.includes(options.keepActiveSpace)) activeSpace = options.keepActiveSpace;
    renderSpaces(spaces);
  }
  await loadFiles();
}

function uploadFileWithProgress(file, fileIndex, fileTotal, completedBytes, totalBytes) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastProgressAt = Date.now();
    let reachedUploadEnd = false;
    const slowTimer = window.setInterval(() => {
      if (reachedUploadEnd || Date.now() - lastProgressAt < 4000) return;
      progressLabel.textContent = "仍在上传，请不要关闭页面";
    }, 1000);

    function finish() {
      window.clearInterval(slowTimer);
    }

    xhr.open("POST", `/api/upload?space=${encodeURIComponent(activeSpace)}`);
    xhr.responseType = "json";
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    if (adminToken) xhr.setRequestHeader("x-admin-token", adminToken);
    if (spaceToken(activeSpace)) xhr.setRequestHeader("x-space-token", spaceToken(activeSpace));

    xhr.upload.addEventListener("progress", (event) => {
      lastProgressAt = Date.now();
      if (!event.lengthComputable) {
        setProgress(5, "正在上传...");
        return;
      }

      const percent = Math.min(((completedBytes + event.loaded) / totalBytes) * 100, 99);
      setProgress(percent, `正在上传 ${fileIndex + 1}/${fileTotal}：${file.name}`);
    });

    xhr.upload.addEventListener("load", () => {
      reachedUploadEnd = true;
      const percent = Math.min(((completedBytes + file.size) / totalBytes) * 100, 99);
      setProgress(percent, "文件已发送，服务器正在写入磁盘...");
    });

    xhr.addEventListener("load", () => {
      finish();
      const data = xhr.response || {};
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data.error || "上传失败"));
        return;
      }
      resolve(data);
    });

    xhr.addEventListener("error", () => {
      finish();
      reject(new Error("网络错误，上传失败"));
    });
    xhr.addEventListener("abort", () => {
      finish();
      reject(new Error("上传已取消"));
    });
    xhr.send(file);
  });
}

async function uploadFiles(files) {
  if (!files.length || isUploading || !hasSpaceAccess(activeSpace)) return;

    isUploading = true;
    chooseButton.disabled = true;
    spaceSelect.disabled = true;
  setStatus(`正在上传 ${files.length} 个文件...`);
  setProgress(0, "正在准备上传");

  try {
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || 1;
    let completedBytes = 0;

    for (const [index, file] of files.entries()) {
      const data = await uploadFileWithProgress(file, index, files.length, completedBytes, totalBytes);
      completedBytes += file.size;
      renderSpaces(data.spaces || spaces);
      renderFiles(data.files || []);
    }

    setProgress(100, "上传完成");
    setStatus(`已上传 ${files.length} 个文件`);
    window.setTimeout(resetProgress, 1200);
  } finally {
    isUploading = false;
    chooseButton.disabled = false;
    spaceSelect.disabled = false;
    setActiveSpace(activeSpace);
  }
}

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ username: adminUserInput.value.trim(), password: adminPasswordInput.value })
  });
  const data = await response.json();
  if (!response.ok) {
    setStatus(data.error || "管理员登录失败");
    return;
  }

  adminToken = data.token;
  localStorage.setItem("adminToken", adminToken);
  adminPasswordInput.value = "";
  setStatus("管理员已登录");
  await refreshAll();
});

adminLogoutButton.addEventListener("click", async () => {
  if (adminToken) {
    await fetch("/api/admin/logout", {
      method: "POST",
      headers: headers()
    }).catch(() => {});
  }

  adminToken = "";
  localStorage.removeItem("adminToken");
  activeSpace = DEFAULT_SPACE;
  localStorage.setItem("activeSpace", activeSpace);
  renderAdmin(false, null);
  setStatus("管理员已退出");
  await refreshAll({ keepActiveSpace: DEFAULT_SPACE });
});

spaceVisibility.addEventListener("change", () => {
  newSpacePasswordInput.classList.toggle("is-hidden", spaceVisibility.value !== "private");
});

spaceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = spaceInput.value.trim();
  if (!name) return;

  const response = await fetch("/api/spaces", {
    method: "POST",
    headers: headers({ "content-type": "application/json; charset=utf-8" }),
    body: JSON.stringify({
      name,
      visibility: spaceVisibility.value,
      password: newSpacePasswordInput.value
    })
  });
  const data = await response.json();
  if (!response.ok) {
    setStatus(data.error || "创建空间失败");
    return;
  }

  spaceInput.value = "";
  newSpacePasswordInput.value = "";
  activeSpace = data.space;
  setStatus("空间已创建");
  await refreshAll({ keepActiveSpace: activeSpace });
});

deleteSpaceButton.addEventListener("click", async () => {
  if (activeSpace === DEFAULT_SPACE) return;
  if (!confirm(`删除空间“${activeSpace}”？空间内文件也会删除。`)) return;

  const response = await fetch(`/api/spaces?space=${encodeURIComponent(activeSpace)}`, {
    method: "DELETE",
    headers: headers()
  });
  const data = await response.json();
  if (!response.ok) {
    setStatus(data.error || "删除空间失败");
    return;
  }

  activeSpace = data.defaultSpace || DEFAULT_SPACE;
  localStorage.setItem("activeSpace", activeSpace);
  setStatus("空间已删除");
  await refreshAll();
});

async function loginCurrentPrivateSpace(password) {
  const response = await fetch("/api/spaces/login", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ name: activeSpace, password })
  });
  const data = await response.json();
  if (!response.ok) {
    setStatus(data.error || "空间密码错误");
    return false;
  }

  if (data.token) sessionStorage.setItem(`spaceToken:${activeSpace}`, data.token);
  setStatus("空间已解锁");
  hidePrivateSpaceModal();
  await refreshAll();
  return true;
}

spaceLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const ok = await loginCurrentPrivateSpace(spacePasswordInput.value);
  if (!ok) return;
  spacePasswordInput.value = "";
});

privateSpaceLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loginCurrentPrivateSpace(modalSpacePasswordInput.value);
});

modalCloseButton.addEventListener("click", () => {
  hidePrivateSpaceModal();
});

previewCloseButton.addEventListener("click", hidePreview);

previewModal.addEventListener("click", (event) => {
  if (event.target === previewModal) hidePreview();
});

previewImage.addEventListener("load", () => {
  fitPreviewToImage();
});

window.addEventListener("resize", fitPreviewToImage);
window.visualViewport?.addEventListener("resize", fitPreviewToImage);

spaceSelect.addEventListener("change", async () => {
  activeSpace = spaceSelect.value;
  localStorage.setItem("activeSpace", activeSpace);
  setActiveSpace(activeSpace);
  if (!hasSpaceAccess(activeSpace)) {
    setLockedView();
    showPrivateSpaceModal();
    return;
  }
  await loadFiles();
});

chooseButton.addEventListener("click", () => {
  if (!chooseButton.disabled) fileInput.click();
});

dropZone.addEventListener("click", (event) => {
  if (event.target === chooseButton || isUploading || chooseButton.disabled) return;
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
  const preview = event.target.closest("[data-preview]");
  if (preview) {
    showPreview(preview.dataset.preview);
    return;
  }

  const download = event.target.closest("[data-download]");
  if (download) {
    const token = spaceToken(activeSpace);
    const baseUrl = `/files?space=${encodeURIComponent(activeSpace)}&name=${encodeURIComponent(download.dataset.download)}`;
    download.href = baseUrl;
    if (adminToken || token) {
      download.href = `${baseUrl}&token=${encodeURIComponent(token)}&adminToken=${encodeURIComponent(adminToken)}`;
    }
    return;
  }

  const button = event.target.closest("[data-delete]");
  if (!button) return;

  const name = button.dataset.delete;
  if (!confirm(`删除 ${name}？`)) return;

  setStatus("正在删除...");
  const response = await fetch(
    `/api/files?space=${encodeURIComponent(activeSpace)}&name=${encodeURIComponent(name)}`,
    { method: "DELETE", headers: authHeaders(activeSpace) }
  );
  const data = await response.json();

  if (!response.ok) {
    setStatus(data.error || "删除失败");
    return;
  }

  renderSpaces(data.spaces || []);
  renderFiles(data.files || []);
  setStatus("已删除");
});

refreshAll().catch((error) => setStatus(error.message));
