# USD WASM Runtime

OpenUSD WASM 运行时模块，提供 WebAssembly 版本的 USD Hydra 渲染引擎。

## 目录结构

```
usd-wasm/
├── src/
│   ├── bindings/              # WASM bindings（C++ 构建产物）
│   │   ├── emHdBindings.js
│   │   ├── emHdBindings.wasm
│   │   ├── emHdBindings.worker.js
│   │   └── emHdBindings.data
│   └── hydra/                 # Hydra 渲染相关 TypeScript/JavaScript 代码
├── tsconfig.hydra.json        # TypeScript 配置
└── README.md
```

## 构建

### TypeScript 编译

从仓库根目录执行：

```bash
npm run build:usd-wasm
```

这会编译 `usd-wasm/src/hydra/**/*.ts` 文件。

### WASM Bindings 重新构建

WASM bindings 来自 OpenUSD C++ 代码编译，需要使用仓库根目录的构建脚本：

```bash
cd ..  # 回到仓库根目录
bash scripts/rebuild-wasm-speed.sh \
  --robot-trim \
  --emsdk-env ~/.localdeps/emsdk/emsdk_env.sh \
  --usd-repo ./third_party/OpenUSD \
  --build-dir ~/.localdeps/openusd-wasm-speed
```

构建完成后，产物会自动复制到 `usd-wasm/src/bindings/` 目录。

## Bindings 说明

### 文件作用

- `emHdBindings.js`：WASM 模块加载器和 JavaScript 接口
- `emHdBindings.wasm`：编译后的 OpenUSD C++ 代码
- `emHdBindings.worker.js`：Web Worker 线程支持
- `emHdBindings.data`：预加载的数据文件

### 运行时加载

在浏览器中，这些文件通过以下路径访问：

```
/usd/bindings/emHdBindings.js
/usd/bindings/emHdBindings.wasm
/usd/bindings/emHdBindings.worker.js
/usd/bindings/emHdBindings.data
```

服务器配置见 `server.ts` 中的静态文件映射。

### 版本管理

每次更新 bindings 后，需要同步更新 `src/index.ts` 中的缓存 key：

```typescript
const EMHD_BINDINGS_CACHE_KEY = "20260219d";
```

这确保浏览器加载最新版本的 WASM 模块。

## 开发注意事项

1. 不要手动修改 `bindings/` 目录下的文件，它们由 C++ 构建生成
2. 修改 Hydra TypeScript 代码后，运行 `npm run build:usd-wasm`
3. 修改 OpenUSD C++ 代码后，需要重新构建 WASM bindings
4. 更新 bindings 后记得更新缓存 key

## 相关文档

- [仓库根 README](../README.md) - 完整项目文档
- [AGENTS.md](../AGENTS.md) - 详细构建指南
