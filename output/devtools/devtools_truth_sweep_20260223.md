# DevTools + Isaac Truth Sweep (2026-02-23)

- Generated UTC: 2026-02-23
- Server: `http://127.0.0.1:3003`
- Browser tool: Chrome DevTools MCP (`mcp__chrome-devtools__*`)
- Truth tool: `conda run -n isaaclab22 python -u scripts/extract_isaacsim_truth.py`
- Scope: `unitree_model` 主入口 USD 全量回归（8 个）

## 1) Code Path Verification

已确认浏览器加载的是最新修复后的 JS：

- `HydraMesh.js` 包含 `shouldDeferToFinalBatch`
- `ThreeRenderDelegateMaterialOps.js` 包含
  `Missing/failed final-batch entries must still fall back per-mesh`

对应源码改动：

- `usd-wasm/src/hydra/render-delegate/HydraMesh.ts`
- `usd-wasm/src/hydra/render-delegate/ThreeRenderDelegateMaterialOps.ts`

## 2) DevTools Runtime Sweep

所有模型均成功加载；无 `console.error`；Network 无 4xx/5xx。
运行时统计里所有 mesh 都有 `position`（`noPos=0`），未发现“空 mesh 占位”。

| model | loaded text | total | visual | collision | withPos | noPos |
|---|---:|---:|---:|---:|---:|---:|
| h1 | Loaded 47 meshes (visual: 24, collision: 23). | 47 | 24 | 23 | 47 | 0 |
| go2 | Loaded 44 meshes (visual: 17, collision: 27). | 44 | 17 | 27 | 44 | 0 |
| g1_29dof | Loaded 68 meshes (visual: 35, collision: 33). | 68 | 35 | 33 | 68 | 0 |
| g1_23dof | Loaded 59 meshes (visual: 27, collision: 32). | 59 | 27 | 32 | 59 | 0 |
| go2w | Loaded 48 meshes (visual: 17, collision: 31). | 48 | 17 | 31 | 48 | 0 |
| b2 | Loaded 57 meshes (visual: 13, collision: 44). | 57 | 13 | 44 | 57 | 0 |
| h1_2 | Loaded 103 meshes (visual: 55, collision: 48). | 103 | 55 | 48 | 103 | 0 |
| h1_2_handless | Loaded 51 meshes (visual: 29, collision: 22). | 51 | 29 | 22 | 51 | 0 |

## 3) Isaac Sim Truth Summary

| model | mesh_count | visual_mesh_count | collision_mesh_count | collision_primitive_count |
|---|---:|---:|---:|---:|
| h1 | 21 | 21 | 0 | 23 |
| go2 | 17 | 17 | 0 | 27 |
| g1_29dof | 50 | 35 | 15 | 33 |
| g1_23dof | 47 | 27 | 20 | 32 |
| go2w | 21 | 17 | 4 | 31 |
| b2 | 13 | 13 | 0 | 44 |
| h1_2 | 101 | 55 | 46 | 48 |
| h1_2_handless | 49 | 29 | 20 | 22 |

## 4) Diff Interpretation

- `visual` 计数在所有模型与 `visual_mesh_count` 一致，**仅 H1 多 3 个**。
- H1 多出的 3 个是 `visuals.proto_sphere_id*`（`torso_link` 下的视觉 primitive），
  属于视觉 primitive，不属于 Isaac 脚本里的 Mesh 统计口径（该脚本统计的是 Mesh 类型）。
- `collision` 计数在所有模型都与 `collision_primitive_count` 一致。
- 所有模型 `noPos=0`，说明不存在“创建了 mesh 但没有顶点”的失效态。

## 5) Conclusion

1. 目前 `go2/h1/g1` 以及 `unitree_model` 其余主入口模型，未复现“mesh 显示不出”的空几何问题。  
2. 先前回归的核心是 proto 同步 defer + final-batch fallback 覆盖不完整，已由当前修复路径兜住。  
3. 你看到“像没 mesh”的主要混淆来自：`Show Collisions` 开启时碰撞体半透明覆盖视觉体（尤其 H1/Go2 视角正对时更明显）。  

## 6) Joint Interaction Spot Check

- 在 H1 页面将 `left_ankle [Y]` 从约 `0°` 改到 `-19.9°` 后：
  - UI 数值已更新为 `-19.9°`
  - 采样可视 mesh 的 `matrixWorld` 发生变化（矩阵元素总差值约 `1.369`）
- 结论：关节滑条到 3D 变换链路正常生效。
