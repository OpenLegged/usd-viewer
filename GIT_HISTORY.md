# Git History Rebuild (2026-02-21)

## 变更说明

本仓库的 Git 历史已于 2026-02-21 重建，移除了所有 Needle Tools 的历史提交，创建了一个全新的干净历史。

## 重建原因

1. 移除第三方（Needle Tools）的历史提交记录
2. 将 `perf/wasm-heavy-pipeline` 分支作为新的 main 分支
3. 包含完整的 OpenUSD 源码到仓库内（`third_party/OpenUSD/`）
4. 创建一个干净的起点，只包含项目实际需要的代码

## 新的 Git 历史

- **初始提交**: `Initial commit: USD Viewer with OpenUSD WASM`
  - 包含完整的机器人 USD Viewer 实现
  - OpenUSD WASM 运行时和优化的加载管线
  - 完整的 OpenUSD C++ 源码（`third_party/OpenUSD/`）
  - 机器人模型支持（Piper, Unitree G1 等）
  - Isaac Sim 真值对比工具

## 分支说明

- **main**: 新的主分支，基于原 `perf/wasm-heavy-pipeline` 的最新状态
- **backup-before-rewrite**: 重建前的完整历史备份（如需恢复旧历史可使用此分支）

## 旧分支（已删除）

以下本地分支已被删除，但在 `backup-before-rewrite` 中仍可访问：
- `feat/direct-mesh-stage-read-fastpath`
- `feat/robot-usd-isaacsim-parity`
- `perf/wasm-heavy-pipeline`
- 原 `main` 分支

## 远程仓库

如需推送到远程仓库，建议使用强制推送（需谨慎）：

```bash
# 推送新的 main 分支（会覆盖远程历史）
git push origin main --force

# 可选：推送备份分支
git push origin backup-before-rewrite
```

## 恢复旧历史

如果需要恢复旧的 Git 历史：

```bash
# 切换到备份分支
git checkout backup-before-rewrite

# 创建新分支或恢复 main
git branch -D main
git checkout -b main
```

## 仓库大小

- Git 仓库: ~240MB
- OpenUSD 源码: ~283MB
- 总计: ~523MB

## 注意事项

1. 所有协作者需要重新克隆仓库或使用 `git pull --rebase` 后强制重置
2. 旧的提交 SHA 已全部改变
3. 如有基于旧提交的 PR 或 issue 引用，需要更新
4. 建议在推送前通知所有团队成员

## 相关文档

- [README.md](./README.md) - 项目主文档
- [AGENTS.md](./AGENTS.md) - 构建和开发指南
- [third_party/README.md](./third_party/README.md) - OpenUSD 源码说明
