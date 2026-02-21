# USD Viewer Build Notes (WASM)

## 1) WASM 编译位置（C++/OpenUSD）

- OpenUSD 源码现已包含在本 repo 内（`third_party/OpenUSD/`），通过 `scripts/rebuild-wasm-speed.sh` 进行 WASM 编译：
  - 必填参数：
    - `--usd-repo <path>`：必须包含 `build_scripts/build_usd.py`（现在使用 `./third_party/OpenUSD`）
    - `--build-dir <path>`：OpenUSD 的构建输出目录
  - 推荐示例（使用仓库内源码）：
    - `bash scripts/rebuild-wasm-speed.sh --emsdk-env ~/.localdeps/emsdk/emsdk_env.sh --usd-repo ./third_party/OpenUSD --build-dir ~/.localdeps/openusd-wasm-speed`

- C++ 构建产物来源目录（脚本内部）：
  - `<build-dir>/bin/emHdBindings.js`
  - `<build-dir>/bin/emHdBindings.wasm`
  - `<build-dir>/bin/emHdBindings.worker.js`
  - `<build-dir>/bin/emHdBindings.data`

- C++ 产物默认复制到本 repo：
  - `usd-wasm/src/bindings/`（可通过 `--dest-dir` 改）

- 速度构建脚本会做的额外处理：
  - 可选 `wasm-opt`（默认 `-O3`，可 `WASM_OPT_LEVEL` 覆盖，`--skip-wasm-opt` 可跳过）
  - 对 `emHdBindings.js` 打补丁（`public/patches/*.patch`）
  - 追加兼容性文本补丁（例如 `USD_WASM_MODULE` 导出、FS 暴露、abort 行为）


## 2) 本仓库编译链路

- `npm run build:usd-wasm`
  - 执行：`npx tsc -p usd-wasm/tsconfig.hydra.json`
  - 作用：编译 `usd-wasm/src/hydra/**/*.ts`，输出 JS 到同目录（in-place）

- `npm run build`
  - 先跑 `build:usd-wasm`
  - 再跑 `node --experimental-strip-types scripts/build.ts`
  - `scripts/build.ts` 最终执行 `npx tsc -p tsconfig.json`
  - `tsconfig.json` 指定 `rootDir=src`、`outDir=public`，即前端主代码编译到 `public/`


## 3) 运行时加载路径与服务映射

- 服务端静态映射（`server.ts`）：
  - `usd-wasm/src` -> `GET /usd/*`
- 因此 bindings 的实际访问路径：
  - `/usd/bindings/emHdBindings.js`
  - `/usd/bindings/emHdBindings.wasm`
  - `/usd/bindings/emHdBindings.worker.js`
  - `/usd/bindings/emHdBindings.data`


## 4) 关键配置（当前行为）

- Bindings 版本缓存 key：
  - `src/index.ts`
  - `import "/usd/bindings/emHdBindings.js?v=20260219d";`
  - `EMHD_BINDINGS_CACHE_KEY = "20260219d"`
  - 每次替换 bindings 后建议同步更新该 key，避免 JS/WASM 缓存错配

- WASM 线程参数（URL Query）：
  - `threadCap`：线程上限
  - `threads`：线程数
  - `prewarmWorkers`：是否预热线程池
  - 在 `src/index.ts` 中映射为：
    - `PTHREAD_POOL_LIMIT`
    - `PTHREAD_POOL_SIZE`
    - `PTHREAD_NUM_CORES`
    - `PTHREAD_POOL_PREWARM`

- 阶段变换预取（URL Query）：
  - `prefetchStageTransforms`
  - 当前默认值在 `src/viewer/usd-loader.ts` 为 `true`（优先保证首帧姿态与关节结果稳定）

- Proto blob 快路径（URL Query）：
  - `enableProtoBlobFastPath`
  - 当前默认开启（在 `src/viewer/usd-loader.ts`），优先加快最终 3D 模型显示；如需对比或排障可通过 URL 参数显式关闭


## 5) 常用命令

- 仅更新 TS/JS（不重编 C++ OpenUSD）：
  - `npm run build`

- 重编 OpenUSD WASM 并回填本仓库 bindings：
  - `bash scripts/rebuild-wasm-speed.sh --emsdk-env <emsdk_env.sh> --usd-repo <OpenUSD repo> --build-dir <build dir>`

- 速度优先 + 机器人相关插件裁剪（不走 `--size-opt`）：
  - `bash scripts/rebuild-wasm-speed.sh --robot-trim --emsdk-env <emsdk_env.sh> --usd-repo ./third_party/OpenUSD --build-dir <build dir>`

- 指定 debug 变体：
  - `bash scripts/rebuild-wasm-speed.sh ... --debug`


## 6) 调试与真值对比流程（新增约束）

- 每次改完代码后，必须使用 Chrome DevTools 对改动功能做验证，并检查 Console/Network 中是否有新增报错。

- 需要联网加速时，先设置代理环境变量：
  - `export https_proxy=http://127.0.0.1:7890`
  - `export http_proxy=http://127.0.0.1:7890`
  - `export all_proxy=socks5://127.0.0.1:7890`

- 可以使用 Isaac Sim API 抽取真值进行对比，基础命令：
  - `conda run -n isaaclab22 python -u scripts/extract_isaacsim_truth.py`

- 问题定位与修复使用通用策略（避免只修单模型特例）：
  - 在 Viewer 与 Isaac Sim 两侧抽取同类真值（例如位姿、关节、mesh、碰撞体、包围盒等）；
  - 对真值结果做结构化对比并定位偏差来源；
  - 优先修复通用加载/解析/映射逻辑，再做回归验证。

- 可按同一套流程检查 `unitree_model/` 下所有模型；常规回归优先测试 `g1_29dof`，全量检查用于发布前或疑难问题排查，确认 mesh 与碰撞体结果一致且可用。

- 完成任务后，必须清理调试残留：
  - 关闭 Chrome DevTools 及相关浏览器标签页；
  - 清理临时日志、临时对比文件与残留调试进程。


## 7) 本机已验证 OpenUSD WASM 编译环境（2026-02-21 更新）

- 可用 `emsdk_env.sh`：
  - `/home/xiangyk/.localdeps/emsdk/emsdk_env.sh`

- OpenUSD 源码位置（已在仓库内）：
  - `./third_party/OpenUSD`（仓库内完整源码）
  - `./OpenUSD`（软链指向 `third_party/OpenUSD`）
  - 备用外部路径：`/home/xiangyk/.localdeps/OpenUSD`（可用于同步更新）

- 可用 OpenUSD WASM 构建目录：
  - `/home/xiangyk/.localdeps/openusd-wasm-speed`

- 实测可直接执行的重编命令（速度优先，使用仓库内源码）：
  - `bash scripts/rebuild-wasm-speed.sh --robot-trim --emsdk-env /home/xiangyk/.localdeps/emsdk/emsdk_env.sh --usd-repo ./third_party/OpenUSD --build-dir /home/xiangyk/.localdeps/openusd-wasm-speed`

- WebGPU 说明（避免误判）：
  - OpenUSD 的 JS bindings 目前依赖 WebGPU 目标；直接关闭 WebGPU 会导致编译失败。
  - `--robot-trim` 当前会保留 JS bindings/WebGPU 链路，同时关闭 `MaterialX/Alembic/Draco/OIIO/OCIO/OpenVDB/Ptex/Embree/PRMan` 这些机器人加载非必需插件。

- 备注（避免踩坑）：
  - 本机上 `/home/xiangyk/Project/_deps/emsdk/emsdk_env.sh` 触发过 `Permission denied`，如遇同样问题优先使用上述 `~/.localdeps/emsdk` 路径。


## 8) OpenUSD 源码管理（2026-02-21 更新）

- OpenUSD 源码现已完整包含在仓库内，便于版本控制和离线构建：
  - 仓库内位置：`third_party/OpenUSD/`
  - 软链位置：`OpenUSD -> third_party/OpenUSD`
  
- 源码同步工具：
  - 脚本：`bash scripts/sync-openusd-source.sh`
  - 默认从 `~/.localdeps/OpenUSD` 同步到 `third_party/OpenUSD`
  - 可选参数：`--source <path>`, `--dest <path>`, `--delete`

- WASM 构建现在使用仓库内源码：
  - OpenUSD C++ 源码（`--usd-repo`）：`./third_party/OpenUSD`
  - WASM 构建输出目录（`--build-dir`）：`~/.localdeps/openusd-wasm-speed`
  - bindings 回填目录（`--dest-dir` 默认）：`usd-wasm/src/bindings/`

- 推荐工作流：
  1. 修改 OpenUSD C++ 代码：编辑 `third_party/OpenUSD/` 下的文件
  2. 重新构建 WASM：`bash scripts/rebuild-wasm-speed.sh --robot-trim --emsdk-env ~/.localdeps/emsdk/emsdk_env.sh --usd-repo ./third_party/OpenUSD --build-dir ~/.localdeps/openusd-wasm-speed`
  3. 更新缓存 key：修改 `src/index.ts` 中的 `EMHD_BINDINGS_CACHE_KEY`
  4. 构建前端：`npm run build`
