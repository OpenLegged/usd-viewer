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
const configurationFileIndex = buildConfigurationFileIndex(unitreeModelRoot);
const piperIsaacSimRoot = path.join(__dirname, "piper_isaac_sim");

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

fastify.get("/configuration/:fileName", async (request: any, reply: any) => {
  const fileName = String(request.params?.fileName || "");
  if (!/^[a-zA-Z0-9_.-]+$/.test(fileName)) {
    return reply.code(400).send("Invalid configuration path");
  }

  const filePath = configurationFileIndex.get(fileName);
  if (!filePath) {
    return reply.code(404).send("Not Found");
  }

  setHeaders(reply.raw, filePath, null);
  reply.header("Content-Type", "application/octet-stream");
  return reply.send(fs.createReadStream(filePath));
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
