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
const DEFAULT_SPACE = "默认空间";

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
  if (!res.writableEnded) {
    res.end();
  }
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
  return sanitizeName(value || DEFAULT_SPACE, DEFAULT_SPACE);
}

function getSpaceDir(space) {
  const spaceName = getSpaceName(space);
  return safeJoin(UPLOAD_DIR, spaceName);
}

async function ensureSpace(space) {
  const spaceName = getSpaceName(space);
  const dir = getSpaceDir(spaceName);
  if (!dir) throw new Error("Invalid space name.");
  await fs.promises.mkdir(dir, { recursive: true });
  return { name: spaceName, dir };
}

async function migrateRootFiles() {
  const defaultSpace = await ensureSpace(DEFAULT_SPACE);
  const entries = await fs.promises.readdir(UPLOAD_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = path.join(UPLOAD_DIR, entry.name);
    const target = path.join(defaultSpace.dir, entry.name);
    if (!fs.existsSync(target)) {
      await fs.promises.rename(source, target);
    }
  }
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

function parseMultipart(body, contentType) {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error("Missing multipart boundary.");

  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const files = [];
  const fields = {};
  let position = 0;

  while (true) {
    const boundaryStart = body.indexOf(boundary, position);
    if (boundaryStart === -1) break;

    let partStart = boundaryStart + boundary.length;
    if (body.slice(partStart, partStart + 2).equals(Buffer.from("--"))) break;
    if (body.slice(partStart, partStart + 2).equals(Buffer.from("\r\n"))) partStart += 2;

    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd === -1) break;

    const headers = body.slice(partStart, headerEnd).toString("utf8");
    const nextBoundary = body.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;

    let dataEnd = nextBoundary;
    if (body.slice(dataEnd - 2, dataEnd).equals(Buffer.from("\r\n"))) dataEnd -= 2;

    const data = body.slice(headerEnd + 4, dataEnd);
    const disposition = headers.match(/content-disposition:\s*form-data;[^\r\n]*/i)?.[0] || "";
    const nameMatch = disposition.match(/name="([^"]+)"/i);
    const filenameMatch = disposition.match(/filename="([^"]*)"/i);

    if (filenameMatch && filenameMatch[1]) {
      files.push({ originalName: filenameMatch[1], data });
    } else if (nameMatch && nameMatch[1]) {
      fields[nameMatch[1]] = data.toString("utf8");
    }

    position = nextBoundary;
  }

  return { files, fields };
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

async function listSpaces() {
  await ensureSpace(DEFAULT_SPACE);
  const entries = await fs.promises.readdir(UPLOAD_DIR, { withFileTypes: true });
  const spaces = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const files = await listFiles(entry.name);
        return {
          name: entry.name,
          fileCount: files.length,
          totalSize: files.reduce((sum, file) => sum + file.size, 0)
        };
      })
  );

  return spaces.sort((a, b) => {
    if (a.name === DEFAULT_SPACE) return -1;
    if (b.name === DEFAULT_SPACE) return 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

async function listFiles(space) {
  const { dir } = await ensureSpace(space);
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

async function serveStatic(req, res, pathname) {
  const requestPath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = safeJoin(PUBLIC_DIR, requestPath);

  if (!filePath) {
    sendError(res, 403, "Forbidden.");
    return;
  }

  try {
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
  } catch (error) {
    sendError(res, 404, "Not found.");
  }
}

async function saveRawUpload(req, space) {
  const originalName = decodeURIComponent(req.headers["x-file-name"] || "file");
  const { name: spaceName, dir } = await ensureSpace(space);
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

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (req.method === "GET" && pathname === "/api/spaces") {
      sendJson(res, 200, { spaces: await listSpaces(), defaultSpace: DEFAULT_SPACE });
      return;
    }

    if (req.method === "POST" && pathname === "/api/spaces") {
      const body = await readJson(req);
      const { name } = await ensureSpace(body.name);
      sendJson(res, 201, { space: name, spaces: await listSpaces() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/files") {
      const space = getSpaceName(url.searchParams.get("space"));
      sendJson(res, 200, { space, files: await listFiles(space) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/upload") {
      if (req.headers["x-file-name"]) {
        const upload = await saveRawUpload(req, url.searchParams.get("space"));
        sendJson(res, 201, {
          space: upload.space,
          saved: [upload.saved],
          spaces: await listSpaces(),
          files: await listFiles(upload.space)
        });
        return;
      }

      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        sendError(res, 400, "Please upload files with multipart/form-data.");
        return;
      }

      const body = await readBody(req);
      const { files, fields } = parseMultipart(body, contentType);
      const { name: space, dir } = await ensureSpace(fields.space);
      const saved = [];

      for (const file of files) {
        const name = uniqueName(file.originalName, dir);
        await fs.promises.writeFile(path.join(dir, name), file.data);
        saved.push({ name, size: file.data.length });
      }

      sendJson(res, 201, {
        space,
        saved,
        spaces: await listSpaces(),
        files: await listFiles(space)
      });
      return;
    }

    if (req.method === "GET" && pathname === "/files") {
      const space = getSpaceName(url.searchParams.get("space"));
      const name = sanitizeName(url.searchParams.get("name"));
      const dir = getSpaceDir(space);
      const filePath = dir ? safeJoin(dir, name) : null;
      if (!filePath || !fs.existsSync(filePath)) {
        sendError(res, 404, "File not found.");
        return;
      }

      const stats = await fs.promises.stat(filePath);
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": stats.size,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
      });
      await pipeline(fs.createReadStream(filePath), res);
      return;
    }

    if (req.method === "DELETE" && pathname === "/api/files") {
      const space = getSpaceName(url.searchParams.get("space"));
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
        spaces: await listSpaces(),
        files: await listFiles(space)
      });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res, pathname);
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

migrateRootFiles()
  .then(() => {
    http.createServer(handleRequest).listen(PORT, HOST, () => {
      console.log(`Cloud storage is running at http://${HOST}:${PORT}`);
      console.log(`Uploaded files are stored in ${UPLOAD_DIR}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
