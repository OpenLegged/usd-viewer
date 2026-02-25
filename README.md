# USD Viewer

A Web viewer for robot models powered by OpenUSD WASM, with USD/USDA/USDC loading, Hydra rendering, and multithreaded WASM.

Chinese version: [README.zh.md](README.zh.md)

## Key Features

- OpenUSD WASM runtime (`usd-wasm/src/bindings/*`)
- Robot model loading and visualization (Unitree, Robots, Piper, etc.)
- Hydra render delegate (`usd-wasm/src/hydra/**`)
- Configurable multithreading parameters (via URL query)

## Project Structure

```text
.
├── src/                         # Frontend TS source (compiled to public/)
├── public/                      # Static assets and frontend build output
├── usd-wasm/src/
│   ├── hydra/                   # Hydra TS/JS runtime code
│   └── bindings/                # OpenUSD WASM build artifacts
├── third_party/OpenUSD/         # OpenUSD source code (vendored)
├── scripts/                     # Build and utility scripts
├── unitree_model/               # Unitree assets
├── Robots/                      # Other robot assets
└── server.ts                    # Fastify static server
```

## Quick Start

### 1) Install dependencies

```bash
npm install
```

### 2) Build and start

```bash
npm start
```

Default address: `http://127.0.0.1:3003`

Example (H1):

```text
http://127.0.0.1:3003/?file=/unitree_model/H1/h1/usd/h1.usd
```

## Build Pipeline

### Build frontend only (without rebuilding C++)

```bash
npm run build
```

Order:

1. `npm run build:usd-wasm` (compile `usd-wasm/src/hydra/**/*.ts`, emit JS in place)
2. `tsc -p tsconfig.json` (`src/**` -> `public/**`)
3. `scripts/sync-vendor.cjs`

### Rebuild OpenUSD WASM (speed-first)

```bash
bash scripts/rebuild-wasm-speed.sh \
  --robot-trim \
  --emsdk-env ~/.localdeps/emsdk/emsdk_env.sh \
  --usd-repo ./third_party/OpenUSD \
  --build-dir ~/.localdeps/openusd-wasm-speed
```

Artifacts are copied back to `usd-wasm/src/bindings/`.

## Runtime Static Routes

Key mappings in `server.ts`:

- `usd-wasm/src` -> `/usd/*`
- `unitree_model` -> `/unitree_model/*`
- `piper_isaac_sim` -> `/piper_isaac_sim/*`
- `Robots` -> `/Robots/*`
- `public` -> `/`

Bindings URLs:

- `/usd/bindings/emHdBindings.js`
- `/usd/bindings/emHdBindings.wasm`
- `/usd/bindings/emHdBindings.worker.js`
- `/usd/bindings/emHdBindings.data`

## Cache and Versioning

After replacing bindings, update `EMHD_BINDINGS_CACHE_KEY` in `src/index.ts` to avoid JS/WASM/data cache mismatch.

## Common URL Parameters

- `threadCap`: thread cap
- `threads`: thread count
- `prewarmWorkers`: whether to prewarm worker pool
- `prefetchStageTransforms`: stage transform prefetch (enabled by default)
- `enableProtoBlobFastPath`: proto blob fast path (enabled by default)

Example:

```text
http://127.0.0.1:3003/?file=/unitree_model/H1/h1/usd/h1.usd&threads=4&prewarmWorkers=1
```

## Suggested Dev Workflow

1. Run `npm run build` after TS changes.
2. Rebuild WASM and update `EMHD_BINDINGS_CACHE_KEY` after OpenUSD C++ changes.
3. Verify no new errors in browser Console/Network.

## Requirements

- Node.js >= 16 (20 recommended)
- Python 3.x (for OpenUSD build scripts)
- Emscripten (for WASM rebuild)

Verified local paths (example):

- `~/.localdeps/emsdk/emsdk_env.sh`
- `./third_party/OpenUSD`
- `~/.localdeps/openusd-wasm-speed`

## FAQ

### 1) Model renders incorrectly

Hard-refresh and confirm `EMHD_BINDINGS_CACHE_KEY` is updated to avoid old JS + new wasm mismatch.

### 2) Thread-related errors

Ensure COEP/COOP headers are present (`server.ts` sets them for key resources).

### 3) WASM rebuild fails

Check that `--usd-repo` contains `build_scripts/build_usd.py`, and verify `emcc/wasm-opt` are available.

## GitHub Repository Description (Ready to Use)

> OpenUSD WASM robot viewer with Hydra rendering and a fast load pipeline.

## License

Apache-2.0 (see `LICENSE.txt`)
