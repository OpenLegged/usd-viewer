# USD Viewer

基于 OpenUSD WASM 的机器人模型 Web Viewer，支持加载和可视化 USD/USDA/USDC 格式的机器人模型文件。

## 特性

- 完整的 OpenUSD WASM 运行时（包含源码和构建脚本）
- 针对机器人模型优化的加载性能
- 支持多线程 WASM 加速
- 集成 Isaac Sim 真值对比工具
- 支持 Piper、Unitree G1 等机器人模型

## 快速开始

### 安装依赖

```bash
npm install
```

### 构建与运行

```bash
npm run build
node server.js
```

默认服务地址：`http://127.0.0.1:3003`

或使用快捷命令：

```bash
npm start
```

## OpenUSD 源码管理

本仓库将 OpenUSD 源码完整包含在 `third_party/OpenUSD/` 目录中，便于版本控制和离线构建。

### 同步 OpenUSD 源码到仓库

如需从本机更新 OpenUSD 源码：

```bash
bash scripts/sync-openusd-source.sh
```

默认行为：
- 源码来源：`~/.localdeps/OpenUSD`
- 仓库目标：`third_party/OpenUSD`
- 自动创建软链：`OpenUSD -> third_party/OpenUSD`

自定义参数：

```bash
bash scripts/sync-openusd-source.sh \
  --source /path/to/OpenUSD \
  --dest /path/to/usd-viewer/third_party/OpenUSD \
  --delete
```

## WASM 构建

### 速度优先构建（推荐）

针对机器人模型优化，裁剪非必需插件：

```bash
bash scripts/rebuild-wasm-speed.sh \
  --robot-trim \
  --emsdk-env ~/.localdeps/emsdk/emsdk_env.sh \
  --usd-repo ./third_party/OpenUSD \
  --build-dir ~/.localdeps/openusd-wasm-speed
```

或使用 npm 脚本：

```bash
npm run rebuild:wasm:speed
```

### 构建参数说明

- `--robot-trim`：裁剪 MaterialX/Alembic/Draco/OIIO/OCIO/OpenVDB/Ptex/Embree/PRMan 等非机器人必需插件
- `--emsdk-env`：Emscripten SDK 环境脚本路径
- `--usd-repo`：OpenUSD 源码目录（现在使用仓库内的 `third_party/OpenUSD`）
- `--build-dir`：WASM 构建输出目录
- `--debug`：构建 debug 版本
- `--skip-wasm-opt`：跳过 wasm-opt 优化

### 构建产物

WASM 构建完成后，产物会自动复制到：

```
usd-wasm/src/bindings/
├── emHdBindings.js
├── emHdBindings.wasm
├── emHdBindings.worker.js
└── emHdBindings.data
```

## 项目结构

```
.
├── src/                          # 前端源码
│   ├── index.ts                  # 入口文件
│   └── viewer/                   # Viewer 核心逻辑
├── usd-wasm/                     # WASM 运行时
│   ├── src/
│   │   ├── bindings/             # WASM bindings（构建产物）
│   │   └── hydra/                # Hydra 渲染相关
│   └── tsconfig.hydra.json
├── third_party/
│   └── OpenUSD/                  # OpenUSD 完整源码
├── scripts/
│   ├── rebuild-wasm-speed.sh     # WASM 构建脚本
│   ├── sync-openusd-source.sh    # OpenUSD 源码同步脚本
│   └── extract_isaacsim_truth.py # Isaac Sim 真值提取
├── public/                       # 静态资源（构建输出）
├── server.ts                     # 开发服务器
└── package.json
```

## 开发工作流

### 1. 仅修改 TypeScript 代码

```bash
npm run build
```

### 2. 修改 OpenUSD C++ 代码

```bash
# 重新构建 WASM
bash scripts/rebuild-wasm-speed.sh --robot-trim \
  --emsdk-env ~/.localdeps/emsdk/emsdk_env.sh \
  --usd-repo ./third_party/OpenUSD \
  --build-dir ~/.localdeps/openusd-wasm-speed

# 更新缓存版本号
# 编辑 src/index.ts 中的 EMHD_BINDINGS_CACHE_KEY

# 重新构建前端
npm run build
```

### 3. 调试与验证

```bash
# 启动服务器
npm start

# 在浏览器中打开 Chrome DevTools
# 检查 Console 和 Network 面板
```

## 真值对比（Isaac Sim）

使用 Isaac Sim API 提取真值进行对比验证：

```bash
# 设置代理（如需）
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890

# 提取真值
conda run -n isaaclab22 python -u scripts/extract_isaacsim_truth.py
```

## 配置说明

### WASM 线程配置

通过 URL 参数控制：

- `threadCap`：线程上限
- `threads`：线程数
- `prewarmWorkers`：是否预热线程池

示例：`http://127.0.0.1:3003/?threads=4&prewarmWorkers=true`

### 性能优化选项

- `prefetchStageTransforms`：预取阶段变换（默认 `true`）
- `enableProtoBlobFastPath`：启用 proto blob 快速路径（默认 `true`）

## 依赖环境

### 运行时

- Node.js >= 16.x
- 现代浏览器（支持 WebAssembly 和 SharedArrayBuffer）

### 构建时

- Emscripten SDK（用于 WASM 编译）
- Python 3.x（用于 OpenUSD 构建脚本）
- CMake >= 3.14
- wasm-opt（可选，用于优化）

### 本机已验证环境

- Emscripten: `~/.localdeps/emsdk/emsdk_env.sh`
- OpenUSD 源码: `third_party/OpenUSD/`（仓库内）
- 构建目录: `~/.localdeps/openusd-wasm-speed`

## 常见问题

### WASM 加载失败

检查 `src/index.ts` 中的 `EMHD_BINDINGS_CACHE_KEY` 是否与 bindings 版本匹配。

### 线程池错误

确保浏览器支持 SharedArrayBuffer，需要正确的 CORS 头配置。

### 构建失败

检查 Emscripten SDK 是否正确安装和激活：

```bash
source ~/.localdeps/emsdk/emsdk_env.sh
emcc --version
```

## 许可证

Apache 2.0 License

## 相关文档

- [AGENTS.md](./AGENTS.md) - 详细的构建和调试指南
- [OpenUSD Documentation](https://openusd.org/)
- [Emscripten Documentation](https://emscripten.org/)
