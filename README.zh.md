# USD Viewer

基于 OpenUSD WASM 的机器人模型 Web Viewer，支持 USD/USDA/USDC 加载、Hydra 渲染与多线程 WASM。

English version: [README.md](README.md)

## 核心能力

- OpenUSD WASM 运行时（`usd-wasm/src/bindings/*`）
- 机器人模型加载与可视化（Unitree、Robots、Piper 等）
- Hydra 渲染委托（`usd-wasm/src/hydra/**`）
- 多线程参数可配（URL Query）

## 目录结构

```text
.
├── src/                         # 前端 TS 源码（编译到 public/）
├── public/                      # 静态资源与前端编译输出
├── usd-wasm/src/
│   ├── hydra/                   # Hydra TS/JS 运行时代码
│   └── bindings/                # OpenUSD WASM 构建产物
├── third_party/OpenUSD/         # OpenUSD 源码（仓库内）
├── scripts/                     # 构建与工具脚本
├── unitree_model/               # Unitree 模型
├── Robots/                      # 其他机器人模型
└── server.ts                    # Fastify 静态服务
```

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 构建并启动

```bash
npm start
```

默认地址：`http://127.0.0.1:3003`

示例（H1）：

```text
http://127.0.0.1:3003/?file=/unitree_model/H1/h1/usd/h1.usd
```

## 构建链路

### 仅构建前端（不重编 C++）

```bash
npm run build
```

执行顺序：

1. `npm run build:usd-wasm`（编译 `usd-wasm/src/hydra/**/*.ts`，原地输出 JS）
2. `tsc -p tsconfig.json`（`src/**` -> `public/**`）
3. `scripts/sync-vendor.cjs`

### OpenUSD WASM 重编（速度优先）

```bash
bash scripts/rebuild-wasm-speed.sh \
  --robot-trim \
  --emsdk-env ~/.localdeps/emsdk/emsdk_env.sh \
  --usd-repo ./third_party/OpenUSD \
  --build-dir ~/.localdeps/openusd-wasm-speed
```

构建后产物会回填到 `usd-wasm/src/bindings/`。

## 运行时静态映射

`server.ts` 中关键映射：

- `usd-wasm/src` -> `/usd/*`
- `unitree_model` -> `/unitree_model/*`
- `piper_isaac_sim` -> `/piper_isaac_sim/*`
- `Robots` -> `/Robots/*`
- `public` -> `/`

Bindings 实际访问路径：

- `/usd/bindings/emHdBindings.js`
- `/usd/bindings/emHdBindings.wasm`
- `/usd/bindings/emHdBindings.worker.js`
- `/usd/bindings/emHdBindings.data`

## 缓存与版本

每次替换 bindings 后，建议同步更新 `src/index.ts` 中的 `EMHD_BINDINGS_CACHE_KEY`，避免 JS/WASM/data 缓存错配。

## 常用 URL 参数

- `threadCap`：线程上限
- `threads`：线程数
- `prewarmWorkers`：是否预热线程池
- `prefetchStageTransforms`：阶段变换预取（默认开启）
- `enableProtoBlobFastPath`：proto blob 快路径（默认开启）

示例：

```text
http://127.0.0.1:3003/?file=/unitree_model/H1/h1/usd/h1.usd&threads=4&prewarmWorkers=1
```

## 开发流程建议

1. 修改 TS 后执行 `npm run build`
2. 修改 OpenUSD C++ 后重编 WASM，并更新 `EMHD_BINDINGS_CACHE_KEY`
3. 浏览器检查 Console/Network 是否有新增错误

## 环境要求

- Node.js >= 16（建议 20）
- Python 3.x（OpenUSD 构建脚本）
- Emscripten（重编 WASM）

已验证路径示例：

- `~/.localdeps/emsdk/emsdk_env.sh`
- `./third_party/OpenUSD`
- `~/.localdeps/openusd-wasm-speed`

## 常见问题

### 1) 模型显示异常

先强制刷新并确认 `EMHD_BINDINGS_CACHE_KEY` 已更新，避免旧 JS + 新 wasm 错配。

### 2) 线程相关报错

确认响应头包含 COEP/COOP（`server.ts` 已对关键资源设置）。

### 3) WASM 重编失败

优先检查 `--usd-repo` 是否包含 `build_scripts/build_usd.py`，并确认 `emcc/wasm-opt` 可用。

## GitHub 仓库 Description（可直接用）

> 基于 OpenUSD WASM 的机器人模型 Viewer，支持 Hydra 渲染与快速加载链路。

## 许可证

Apache-2.0（见 `LICENSE.txt`）
