# DevTools MCP Native Check Report (2026-02-23, C++/WASM axis fix)

- Generated UTC: 2026-02-23T03:56:54Z
- Server: http://127.0.0.1:3003
- Scope: `g1_29dof`, `go2`
- Build key: `EMHD_BINDINGS_CACHE_KEY=20260223a`

## Model A: G1 29DoF

- URL:
  - `http://127.0.0.1:3003/?file=/unitree_model/G1/29dof/usd/g1_29dof_rev_1_0/g1_29dof_rev_1_0.usd&showVisuals=1&showCollisions=1&showDynamics=1&showRobotInspector=1&readStageMetadata=1&cb=20260223-cppfix-g1`
- Page status:
  - `Loaded 68 meshes (visual: 35, collision: 33).`
  - Joint panel axis labels now mixed and correct (e.g. `left_ankle_pitch [Y]`, `left_ankle_roll [X]`, `left_hip_yaw [Z]`).
- Screenshot:
  - `output/devtools/g1_29dof_cppfix_20260223.png`

### Console

1. `warn` GPU stall due to `ReadPixels`
2. `warn` GPU stall due to `ReadPixels`
3. `warn` GPU stall due to `ReadPixels (will no longer repeat)`

- `console.error`: none

### Network

- Total requests: 77
- Status set: `200` only
- 4xx/5xx: none
- Transport failure: none

## Model B: Go2

- URL:
  - `http://127.0.0.1:3003/?file=/unitree_model/Go2/usd/go2.usd&showVisuals=1&showCollisions=1&showDynamics=1&showRobotInspector=1&readStageMetadata=1&cb=20260223-cppfix-go2`
- Page status:
  - `Loaded 44 meshes (visual: 17, collision: 27).`
  - Joint panel axis labels now correct (`hip [X]`, `thigh/calf [Y]`).
- Screenshot:
  - `output/devtools/go2_cppfix_20260223.png`

### Console

- No console messages.
- `console.error`: none

### Network

- Total requests: 76
- Status set: `200` and `304`
- 4xx/5xx: none
- Transport failure: none

`304` entries are standard cache revalidation and expected.

## Verdict

- C++/WASM axis fix build (`20260223a`) shows no new Console/Network regressions on `g1_29dof` and `go2`.
- Runtime joint axes displayed in UI are aligned with truth expectations.
