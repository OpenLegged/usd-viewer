# Third Party Dependencies

本目录包含项目依赖的第三方源码。

## OpenUSD

完整的 OpenUSD (Universal Scene Description) 源码，用于编译 WebAssembly 版本的 USD 库。

### 目录

```
OpenUSD/
├── pxr/                    # Pixar USD 核心库
│   ├── base/              # 基础工具和类型
│   ├── usd/               # USD 核心 API
│   ├── usdImaging/        # USD 到 Hydra 的桥接
│   └── imaging/           # Hydra 渲染框架
├── build_scripts/         # 构建脚本
│   └── build_usd.py      # 主构建脚本
├── cmake/                 # CMake 配置
└── ...
```

### 版本信息

- 来源：Pixar OpenUSD
- 许可证：Apache 2.0 / Modified Apache 2.0
- 官方网站：https://openusd.org/
- GitHub：https://github.com/PixarAnimationStudios/OpenUSD

### 本地修改

为了支持 WebAssembly 编译和机器人模型优化，本仓库的 OpenUSD 源码包含以下修改：

1. Emscripten 兼容性补丁（`pxr/usdImaging/hdEmscripten/patches/`）
2. 针对 WASM 的构建配置调整
3. 机器人模型相关的性能优化

### 同步与更新

从本机同步 OpenUSD 源码到仓库：

```bash
bash scripts/sync-openusd-source.sh
```

默认从 `~/.localdeps/OpenUSD` 同步到 `third_party/OpenUSD`。

### 构建

OpenUSD 的 WASM 构建通过仓库根目录的脚本完成：

```bash
bash scripts/rebuild-wasm-speed.sh \
  --robot-trim \
  --emsdk-env ~/.localdeps/emsdk/emsdk_env.sh \
  --usd-repo ./third_party/OpenUSD \
  --build-dir ~/.localdeps/openusd-wasm-speed
```

构建产物会自动复制到 `usd-wasm/src/bindings/` 目录。

## 为什么包含完整源码？

1. 版本控制：确保所有开发者使用相同版本的 OpenUSD
2. 离线构建：无需依赖外部网络下载源码
3. 自定义修改：便于维护针对项目的特定修改
4. 构建稳定性：避免上游变更导致的构建问题

## 许可证

OpenUSD 使用 Modified Apache 2.0 License，详见 `OpenUSD/LICENSE.txt`。
