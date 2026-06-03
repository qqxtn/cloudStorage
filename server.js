const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");

const PORT = Number(process.env.PORT || 3107);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DATA_FILE = path.join(ROOT, "cloud-drive-data.json");
const LEGACY_DEFAULT_SPACE = "\u9ed8\u8ba4\u7a7a\u95f4";
const DEFAULT_SPACE = "\u516c\u5171\u7a7a\u95f4";

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const adminSessions = new Set();
const spaceSessions = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  if (res.writableEnded) return;
  if (res.headersSent) {
    res.end();
    return;
  }

  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function finishAfterHeadersSent(res) {
  if (!res.writableEnded) res.end();
}

function isExpectedClientDisconnect(error) {
  return error && (
    error.code === "ERR_STREAM_PREMATURE_CLOSE" ||
    error.code === "ECONNRESET" ||
    error.code === "EPIPE"
  );
}

function safeJoin(base, target) {
  const resolved = path.resolve(base, target);
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
    return null;
  }
  return resolved;
}

function sanitizeName(name, fallback = "file") {
  const base = path.basename(String(name || fallback));
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return cleaned || fallback;
}

function getSpaceName(value) {
  const name = sanitizeName(value || DEFAULT_SPACE, DEFAULT_SPACE);
  return name === LEGACY_DEFAULT_SPACE ? DEFAULT_SPACE : name;
}

function getSpaceDir(space) {
  return safeJoin(UPLOAD_DIR, getSpaceName(space));
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hashPassword(password, salt = randomToken(16)) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, expected] = stored.split(":");
  const actual = crypto.scryptSync(String(password), salt, 64);
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), actual);
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    const backup = `${DATA_FILE}.broken-${Date.now()}`;
    fs.renameSync(DATA_FILE, backup);
    console.warn(`Invalid data file was backed up to ${backup}`);
    return null;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function createInitialData() {
  const username = "admin";
  const password = randomToken(12);
  const data = {
    admin: {
      username,
      password,
      passwordHash: hashPassword(password)
    },
    spaces: {
      [DEFAULT_SPACE]: {
        name: DEFAULT_SPACE,
        visibility: "public",
        passwordHash: null,
        createdAt: new Date().toISOString()
      }
    }
  };
  saveData(data);
  return { data, created: true };
}

function getData() {
  let data = loadData();
  let created = false;
  if (!data) {
    const initial = createInitialData();
    data = initial.data;
    created = true;
  }

  data.spaces ||= {};
  if (data.spaces[LEGACY_DEFAULT_SPACE] && !data.spaces[DEFAULT_SPACE]) {
    data.spaces[DEFAULT_SPACE] = {
      ...data.spaces[LEGACY_DEFAULT_SPACE],
      name: DEFAULT_SPACE,
      visibility: "public",
      passwordHash: null
    };
    delete data.spaces[LEGACY_DEFAULT_SPACE];
  }
  data.spaces[DEFAULT_SPACE] ||= {
    name: DEFAULT_SPACE,
    visibility: "public",
    passwordHash: null,
    createdAt: new Date().toISOString()
  };
  saveData(data);
  return { data, created };
}

let { data: appData, created: credentialsCreated } = getData();

async function ensureSpaceDir(space) {
  const spaceName = getSpaceName(space);
  const dir = getSpaceDir(spaceName);
  if (!dir) throw new Error("Invalid space name.");
  await fs.promises.mkdir(dir, { recursive: true });
  return { name: spaceName, dir };
}

async function migrateRootFiles() {
  const defaultSpace = await ensureSpaceDir(DEFAULT_SPACE);
  const legacyDir = safeJoin(UPLOAD_DIR, LEGACY_DEFAULT_SPACE);
  if (legacyDir && fs.existsSync(legacyDir) && legacyDir !== defaultSpace.dir) {
    const entries = await fs.promises.readdir(legacyDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const source = path.join(legacyDir, entry.name);
      const target = path.join(defaultSpace.dir, uniqueName(entry.name, defaultSpace.dir));
      await fs.promises.rename(source, target);
    }
    await fs.promises.rm(legacyDir, { recursive: true, force: true });
  }

  const entries = await fs.promises.readdir(UPLOAD_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = path.join(UPLOAD_DIR, entry.name);
    const target = path.join(defaultSpace.dir, entry.name);
    if (!fs.existsSync(target)) await fs.promises.rename(source, target);
  }
}

async function importExistingDirectories() {
  const entries = await fs.promises.readdir(UPLOAD_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = getSpaceName(entry.name);
    appData.spaces[name] ||= {
      name,
      visibility: "public",
      passwordHash: null,
      createdAt: new Date().toISOString()
    };
  }
  saveData(appData);
}

function getAdminToken(req) {
  return req.headers["x-admin-token"] || req.routeUrl?.searchParams.get("adminToken") || "";
}

function isAdmin(req) {
  return adminSessions.has(getAdminToken(req));
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  sendError(res, 401, "Admin login required.");
  return false;
}

function getSpaceToken(req) {
  return req.headers["x-space-token"] || req.routeUrl?.searchParams.get("token") || "";
}

function isSpaceUnlocked(req, space) {
  if (isAdmin(req)) return true;
  const token = getSpaceToken(req);
  return token && spaceSessions.get(token) === space;
}

function getSpaceMeta(space) {
  return appData.spaces[getSpaceName(space)];
}

function requireSpaceAccess(req, res, space) {
  const meta = getSpaceMeta(space);
  if (!meta) {
    sendError(res, 404, "Space not found.");
    return false;
  }
  if (meta.visibility === "public" || isSpaceUnlocked(req, meta.name)) return true;
  sendError(res, 401, "Space password required.");
  return false;
}

function publicSpaceMeta(meta, stats) {
  return {
    name: meta.name,
    visibility: meta.visibility || "public",
    locked: meta.visibility === "private",
    fileCount: stats.fileCount,
    totalSize: stats.totalSize,
    createdAt: meta.createdAt
  };
}

function uniqueName(originalName, dir) {
  const safeName = sanitizeName(originalName);
  const ext = path.extname(safeName);
  const name = path.basename(safeName, ext);
  let candidate = safeName;
  let counter = 1;

  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${name}-${counter}${ext}`;
    counter += 1;
  }

  return candidate;
}

async function readBody(req, limitBytes = 1024 * 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error("Upload is too large.");
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readJson(req) {
  const body = await readBody(req, 1024 * 1024);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

async function listFiles(space) {
  const { dir } = await ensureSpaceDir(space);
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filePath = path.join(dir, entry.name);
        const stats = await fs.promises.stat(filePath);
        return {
          name: entry.name,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          id: crypto.createHash("sha1").update(`${space}/${entry.name}`).digest("hex")
        };
      })
  );

  return files.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

async function getSpaceStats(space) {
  const files = await listFiles(space);
  return {
    fileCount: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0)
  };
}

async function listSpaces(req) {
  const spaces = await Promise.all(
    Object.values(appData.spaces).map(async (meta) => {
      await ensureSpaceDir(meta.name);
      const stats = await getSpaceStats(meta.name);
      const result = publicSpaceMeta(meta, stats);
      result.unlocked = meta.visibility === "public" || isSpaceUnlocked(req, meta.name);
      return result;
    })
  );

  return spaces.sort((a, b) => {
    if (a.name === DEFAULT_SPACE) return -1;
    if (b.name === DEFAULT_SPACE) return 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

async function serveStatic(res, pathname) {
  const requestPath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = safeJoin(PUBLIC_DIR, requestPath);

  if (!filePath) {
    sendError(res, 403, "Forbidden.");
    return;
  }

  const stats = await fs.promises.stat(filePath);
  if (!stats.isFile()) {
    sendError(res, 404, "Not found.");
    return;
  }

  res.writeHead(200, {
    "content-type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "content-length": stats.size
  });
  await pipeline(fs.createReadStream(filePath), res);
}

async function saveRawUpload(req, space) {
  const originalName = decodeURIComponent(req.headers["x-file-name"] || "file");
  const { name: spaceName, dir } = await ensureSpaceDir(space);
  const name = uniqueName(originalName, dir);
  const target = path.join(dir, name);

  try {
    await pipeline(req, fs.createWriteStream(target));
  } catch (error) {
    await fs.promises.rm(target, { force: true });
    throw error;
  }

  const stats = await fs.promises.stat(target);
  return { space: spaceName, saved: { name, size: stats.size } };
}

async function deleteDirectory(dir) {
  const resolved = path.resolve(dir);
  const root = path.resolve(UPLOAD_DIR);
  if (!resolved.startsWith(root + path.sep)) throw new Error("Invalid delete target.");
  await fs.promises.rm(resolved, { recursive: true, force: true });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  req.routeUrl = url;
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (req.method === "GET" && pathname === "/api/admin/status") {
      sendJson(res, 200, {
        loggedIn: isAdmin(req),
        username: isAdmin(req) ? appData.admin.username : null
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/login") {
      const body = await readJson(req);
      const ok = body.username === appData.admin.username && verifyPassword(body.password, appData.admin.passwordHash);
      if (!ok) {
        sendError(res, 401, "Invalid admin credentials.");
        return;
      }
      const token = randomToken();
      adminSessions.add(token);
      sendJson(res, 200, { token, username: appData.admin.username });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/logout") {
      const token = getAdminToken(req);
      if (token) adminSessions.delete(token);
      sendJson(res, 200, { loggedIn: false });
      return;
    }

    if (req.method === "POST" && pathname === "/api/spaces/login") {
      const body = await readJson(req);
      const name = getSpaceName(body.name);
      const meta = getSpaceMeta(name);
      if (!meta) {
        sendError(res, 404, "Space not found.");
        return;
      }
      if (meta.visibility === "public") {
        sendJson(res, 200, { token: null, space: name });
        return;
      }
      if (!verifyPassword(body.password, meta.passwordHash)) {
        sendError(res, 401, "Invalid space password.");
        return;
      }
      const token = randomToken();
      spaceSessions.set(token, name);
      sendJson(res, 200, { token, space: name });
      return;
    }

    if (req.method === "GET" && pathname === "/api/spaces") {
      sendJson(res, 200, {
        spaces: await listSpaces(req),
        defaultSpace: DEFAULT_SPACE,
        admin: { loggedIn: isAdmin(req), username: isAdmin(req) ? appData.admin.username : null }
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/spaces") {
      if (!requireAdmin(req, res)) return;
      const body = await readJson(req);
      const name = getSpaceName(body.name);
      const visibility = body.visibility === "private" ? "private" : "public";
      if (appData.spaces[name]) {
        sendError(res, 409, "Space already exists.");
        return;
      }
      if (visibility === "private" && !body.password) {
        sendError(res, 400, "Private space password is required.");
        return;
      }

      appData.spaces[name] = {
        name,
        visibility,
        passwordHash: visibility === "private" ? hashPassword(body.password) : null,
        createdAt: new Date().toISOString()
      };
      saveData(appData);
      await ensureSpaceDir(name);
      sendJson(res, 201, { space: name, spaces: await listSpaces(req) });
      return;
    }

    if (req.method === "DELETE" && pathname === "/api/spaces") {
      if (!requireAdmin(req, res)) return;
      const name = getSpaceName(url.searchParams.get("space"));
      if (name === DEFAULT_SPACE) {
        sendError(res, 400, "Default space cannot be deleted.");
        return;
      }
      if (!appData.spaces[name]) {
        sendError(res, 404, "Space not found.");
        return;
      }

      delete appData.spaces[name];
      saveData(appData);
      const dir = getSpaceDir(name);
      if (dir) await deleteDirectory(dir);
      sendJson(res, 200, { spaces: await listSpaces(req), defaultSpace: DEFAULT_SPACE });
      return;
    }

    if (req.method === "GET" && pathname === "/api/files") {
      const space = getSpaceName(url.searchParams.get("space"));
      if (!requireSpaceAccess(req, res, space)) return;
      sendJson(res, 200, { space, files: await listFiles(space) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/upload") {
      const space = getSpaceName(url.searchParams.get("space"));
      if (!requireSpaceAccess(req, res, space)) return;
      if (!req.headers["x-file-name"]) {
        sendError(res, 400, "Missing x-file-name header.");
        return;
      }

      const upload = await saveRawUpload(req, space);
      sendJson(res, 201, {
        space: upload.space,
        saved: [upload.saved],
        spaces: await listSpaces(req),
        files: await listFiles(upload.space)
      });
      return;
    }

    if (req.method === "GET" && pathname === "/files") {
      const space = getSpaceName(url.searchParams.get("space"));
      if (!requireSpaceAccess(req, res, space)) return;
      const name = sanitizeName(url.searchParams.get("name"));
      const dir = getSpaceDir(space);
      const filePath = dir ? safeJoin(dir, name) : null;
      if (!filePath || !fs.existsSync(filePath)) {
        sendError(res, 404, "File not found.");
        return;
      }

      const stats = await fs.promises.stat(filePath);
      res.writeHead(200, {
        "content-type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "content-length": stats.size
      });
      await pipeline(fs.createReadStream(filePath), res);
      return;
    }

    if (req.method === "DELETE" && pathname === "/api/files") {
      const space = getSpaceName(url.searchParams.get("space"));
      if (!requireSpaceAccess(req, res, space)) return;
      const name = sanitizeName(url.searchParams.get("name"));
      const dir = getSpaceDir(space);
      const filePath = dir ? safeJoin(dir, name) : null;
      if (!filePath || !fs.existsSync(filePath)) {
        sendError(res, 404, "File not found.");
        return;
      }

      await fs.promises.unlink(filePath);
      sendJson(res, 200, {
        space,
        spaces: await listSpaces(req),
        files: await listFiles(space)
      });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(res, pathname);
      return;
    }

    sendError(res, 405, "Method not allowed.");
  } catch (error) {
    if (isExpectedClientDisconnect(error)) {
      finishAfterHeadersSent(res);
      return;
    }

    console.error(error);
    if (res.headersSent) {
      finishAfterHeadersSent(res);
      return;
    }
    sendError(res, 500, error.message || "Server error.");
  }
}

async function start() {
  await migrateRootFiles();
  await importExistingDirectories();

  if (credentialsCreated) {
    console.log("Admin credentials generated:");
  } else {
    console.log("Admin credentials:");
  }
  console.log(`  username: ${appData.admin.username}`);
  console.log(`  password: ${appData.admin.password}`);

  http.createServer(handleRequest).listen(PORT, HOST, () => {
    console.log(`Cloud storage is running at http://${HOST}:${PORT}`);
    console.log(`Uploaded files are stored in ${UPLOAD_DIR}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
