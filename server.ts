const fastify = require("fastify")();
const path = require("path");
const fs = require("fs");

// Headers are required for SharedArrayBuffers and WebAssembly
// Otherwise we wouldn't need a server at all.

function setHeaders(res: any, filePath: string, _stat: unknown) {
  const normalizedFilePath = filePath.replaceAll("\\", "/");
  if (normalizedFilePath.endsWith(".wasm")) {
    res.setHeader("Content-Type", "application/wasm");
  }
  const needsHeaders = normalizedFilePath.includes("/emHd") || normalizedFilePath.endsWith("index.html");
  if (!needsHeaders) return;

  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
}

function buildFileIndex(
  rootDir: string,
  includeFile: (fullPath: string, entryName: string) => boolean
) {
  const map = new Map<string, string>();
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!includeFile(fullPath, entry.name)) continue;
      if (!map.has(entry.name)) {
        map.set(entry.name, fullPath);
      }
    }
  }

  return map;
}

function buildConfigurationFileIndex(rootDir: string) {
  return buildFileIndex(rootDir, (fullPath, entryName) => {
    if (!fullPath.includes(`${path.sep}configuration${path.sep}`)) return false;
    return path.extname(entryName).toLowerCase() === ".usd";
  });
}

const unitreeModelRoot = path.join(__dirname, "unitree_model");
const piperIsaacSimRoot = path.join(__dirname, "piper_isaac_sim");
const robotsRoot = path.join(__dirname, "Robots");
const usdTextParserDistRoot = path.join(__dirname, "packages/usd-text-parser/dist");
const unitreeConfigurationFileIndex = buildConfigurationFileIndex(unitreeModelRoot);
const piperConfigurationFileIndex = buildConfigurationFileIndex(piperIsaacSimRoot);
const robotsConfigurationFileIndex = buildConfigurationFileIndex(robotsRoot);
const configurationFileIndex = new Map<string, string>(unitreeConfigurationFileIndex);
for (const [fileName, filePath] of piperConfigurationFileIndex) {
  if (!configurationFileIndex.has(fileName)) {
    configurationFileIndex.set(fileName, filePath);
  }
}
for (const [fileName, filePath] of robotsConfigurationFileIndex) {
  if (!configurationFileIndex.has(fileName)) {
    configurationFileIndex.set(fileName, filePath);
  }
}
const exportRoots = [
  { virtualPrefix: "/unitree_model", diskRoot: unitreeModelRoot },
  { virtualPrefix: "/piper_isaac_sim", diskRoot: piperIsaacSimRoot },
  { virtualPrefix: "/Robots", diskRoot: robotsRoot },
];

function normalizeVirtualExportPath(rawPath: unknown): string {
  const normalized = String(rawPath || "").trim().replaceAll("\\", "/");
  if (!normalized.startsWith("/")) return "";
  if (normalized.includes("..")) return "";
  return normalized;
}

function resolveExportDiskPath(virtualPath: string): { virtualPath: string; diskPath: string } | null {
  const normalizedVirtualPath = normalizeVirtualExportPath(virtualPath);
  if (!normalizedVirtualPath) return null;
  if (!/\.(usd|usda|usdc)$/i.test(normalizedVirtualPath)) return null;

  for (const { virtualPrefix, diskRoot } of exportRoots) {
    if (!normalizedVirtualPath.startsWith(`${virtualPrefix}/`)) continue;
    const relativePath = normalizedVirtualPath.slice(virtualPrefix.length + 1);
    if (!relativePath) return null;
    const resolvedDiskPath = path.resolve(diskRoot, relativePath);
    const normalizedDiskRoot = `${path.resolve(diskRoot)}${path.sep}`;
    if (resolvedDiskPath !== path.resolve(diskRoot) && !resolvedDiskPath.startsWith(normalizedDiskRoot)) {
      return null;
    }
    return {
      virtualPath: normalizedVirtualPath,
      diskPath: resolvedDiskPath,
    };
  }

  return null;
}

fastify.register(require("@fastify/compress"), {
  // Prioritize smaller transfer size for large WASM/data assets.
  encodings: ["br", "gzip"],
  threshold: 1024,
  customTypes: /^(application\/wasm|application\/octet-stream|application\/javascript|application\/json|text\/)/,
});

fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "usd-wasm/src"),
  prefix: "/usd",
  maxAge: 24 * 60 * 60 * 1000,
  setHeaders,
});

fastify.register(require("@fastify/static"), {
  root: unitreeModelRoot,
  prefix: "/unitree_model",
  setHeaders,
  decorateReply: false,
});

fastify.register(require("@fastify/static"), {
  root: piperIsaacSimRoot,
  prefix: "/piper_isaac_sim",
  setHeaders,
  decorateReply: false,
});

fastify.register(require("@fastify/static"), {
  root: robotsRoot,
  prefix: "/Robots",
  setHeaders,
  decorateReply: false,
});

fastify.register(require("@fastify/static"), {
  root: usdTextParserDistRoot,
  prefix: "/packages/usd-text-parser/dist",
  setHeaders,
  decorateReply: false,
});

function buildConfigurationPlaceholderUsd(fileName: string): string | null {
  if (!/^[a-zA-Z0-9_.-]+$/.test(fileName)) return null;
  if (!/_(base|physics|robot|sensor)\.usd$/i.test(fileName)) return null;
  const defaultPrimName = /_sensor\.usd$/i.test(fileName) ? "Sensors" : "Config";
  return [
    "#usda 1.0",
    "(",
    `    defaultPrim = "${defaultPrimName}"`,
    ")",
    "",
    `def Xform "${defaultPrimName}"`,
    "{",
    "}",
    "",
  ].join("\n");
}

function sendIndexedConfigurationFile(reply: any, fileName: string) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(fileName)) {
    return reply.code(400).send("Invalid configuration path");
  }

  const filePath = configurationFileIndex.get(fileName);
  if (!filePath) {
    const placeholderUsd = buildConfigurationPlaceholderUsd(fileName);
    if (!placeholderUsd) {
      return reply.code(404).send("Not Found");
    }
    reply.header("Content-Type", "application/octet-stream");
    reply.header("X-Usd-Placeholder", "1");
    return reply.send(placeholderUsd);
  }

  setHeaders(reply.raw, filePath, null);
  reply.header("Content-Type", "application/octet-stream");
  return reply.send(fs.createReadStream(filePath));
}

fastify.get("/Robots/:vendor/:model/configuration/:fileName", async (request: any, reply: any) => {
  const fileName = String(request.params?.fileName || "");
  return sendIndexedConfigurationFile(reply, fileName);
});

fastify.get("/configuration/:fileName", async (request: any, reply: any) => {
  const fileName = String(request.params?.fileName || "");
  return sendIndexedConfigurationFile(reply, fileName);
});

fastify.post("/api/write-usd-export", async (request: any, reply: any) => {
  const virtualPath = String(request.body?.virtualPath || "");
  const content = request.body?.content;
  const overwrite = request.body?.overwrite !== false;
  const resolved = resolveExportDiskPath(virtualPath);

  if (!resolved) {
    return reply.code(400).send({
      ok: false,
      error: "Invalid export path. Expected /unitree_model, /piper_isaac_sim, or /Robots USD path.",
    });
  }
  if (typeof content !== "string" || content.length <= 0) {
    return reply.code(400).send({ ok: false, error: "Missing export content." });
  }
  if (!overwrite && fs.existsSync(resolved.diskPath)) {
    return reply.code(409).send({ ok: false, error: "Export path already exists.", virtualPath: resolved.virtualPath });
  }

  fs.mkdirSync(path.dirname(resolved.diskPath), { recursive: true });
  fs.writeFileSync(resolved.diskPath, content, "utf-8");

  return {
    ok: true,
    virtualPath: resolved.virtualPath,
    filePath: resolved.diskPath,
    bytesWritten: Buffer.byteLength(content, "utf-8"),
  };
});

fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "public"),
  prefix: "/",
  setHeaders,
  decorateReply: false,
});

const defaultPort = Number(process.env.PORT || 3003);
const maxPortAttempts = 20;
const validateOnly = process.env.VALIDATE_ONLY === "1";

async function startServerWithFallback(startPort: number) {
  for (let offset = 0; offset < maxPortAttempts; offset++) {
    const port = startPort + offset;
    try {
      const address = await fastify.listen({ port, host: "127.0.0.1" });
      if (offset > 0) {
        console.warn(`Port ${startPort} is in use, switched to ${port}.`);
      }
      console.log(`Your app is listening on ${address}`);
      fastify.log.info(`server listening on ${address}`);
      return;
    } catch (err) {
      if (err.code === "EADDRINUSE" && offset < maxPortAttempts - 1) {
        console.warn(`Port ${port} is in use, trying ${port + 1}...`);
        continue;
      }
      fastify.log.error(err);
      console.error(`Error starting server on port ${port}`, err);
      process.exit(1);
    }
  }
}

if (validateOnly) {
  console.log("Server validation passed.");
} else {
  startServerWithFallback(defaultPort);
}
