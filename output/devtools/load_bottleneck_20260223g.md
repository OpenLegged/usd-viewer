# Load Bottleneck Report (2026-02-23, round g)

## Optimization Applied
- File: `usd-wasm/src/hydra/render-delegate/HydraMesh.ts`
- Changes:
  1. Added primitive geometry template cache (build once, clone many) for box/sphere/cylinder/capsule paths.
  2. Added lighter collision-only tessellation profile (`FAST_COLLISION_PRIMITIVE_SEGMENTS`) to reduce collision overlay mesh build cost.
  3. Routed USD primitive generation through unified descriptor path to reuse the same cache flow.

## G1 End-to-End (same profile harness, 3 runs)
- Before (`20260223f`):
  - first/all mesh ready: `2232 ms`
  - joint ready + joint move verified: `4533 ms`
  - median max `hydra commitMs`: `1338.14 ms`
  - long-task total: `6063 ms`
- After (`20260223g`):
  - first/all mesh ready: `2110 ms`
  - joint ready + joint move verified: `4224 ms`
  - median max `hydra commitMs`: `1278.20 ms`
  - long-task total: `4872 ms`

## Delta
- first/all mesh ready: `-122 ms` (`-5.5%`)
- joint ready: `-309 ms` (`-6.8%`)
- max `commitMs`: `-59.94 ms` (`-4.5%`)
- long-task total: `-1191 ms` (`-19.6%`)

## Bottleneck Status
- Dominant bottleneck remains `CommitResources` (JS-side commit/sync path), not transport.
- Network remains early and stable (no 4xx/5xx; only canceled `net::ERR_ABORTED` background request noise without functional impact).

## Full Unitree Truth Validation (Isaac Sim)
- Command:
  - `python -u scripts/validate_unitree_collisions.py --server http://127.0.0.1:3003 --conda-env isaaclab22 --output-dir output/validation/unitree_collisions_20260223g`
- Result: `models=8, passed=8, failed=0`
- Coverage: collision, mesh, joint axis/limits, inertial.

## Full Unitree Load Sweep (8 models)
- Output: `output/bench/unitree_fullready_bench_20260223g.json`
- Pass: `8/8`
- Median:
  - first/all mesh ready: `2393.5 ms`
  - joint ready: `4237 ms`

## Cleanup
- `npm run cleanup` executed after runs; no stale headless browser processes remained.
