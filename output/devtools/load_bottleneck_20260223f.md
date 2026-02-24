# Load Bottleneck Report (2026-02-23)

## Scope
- Build key: `EMHD_BINDINGS_CACHE_KEY=20260223f`
- Server for measured runs: `http://127.0.0.1:3004`
- Primary profile model: `unitree_model/G1/29dof/usd/g1_29dof_rev_1_0/g1_29dof_rev_1_0.usd`

## End-to-End Timing (G1, median of 3 runs)
- First mesh ready: `2232 ms`
- All meshes ready: `2232 ms`
- Joint panel ready: `4533 ms`
- Joint move verified (angle update + matrix delta): `4533 ms`

Raw data: `output/bench/g1_pipeline_profile_20260223f.json`

## Bottleneck Decomposition
- Network transfer complete early (not dominant):
  - `.wasm` finished by about `220~228 ms`
  - USD stage requests finished by about `838~928 ms`
  - Total transfer ≈ `11.96 MiB` (stage `7.39 MiB`, wasm `3.68 MiB`, data `0.10 MiB`)
- Hydra phase breakdown (max draw sample):
  - `commitMs`: ~`1267~1487 ms` (median max `1338 ms`)
  - `wasmFetchMs`: ~`12 ms`
  - `threeBuildMs`: ~`12 ms`
- Load profile callbacks (sample):
  - `CommitResources`: `1338.4 ms`
  - `pullRprimDeltaBatchFromDriver`: `92.4 ms`
  - `getVisualProtoOverride`: `49.3 ms`
  - `getCollisionProtoOverride`: `28.2 ms`

## Interpretation
1. Primary bottleneck is **frontend <-> WASM commit path** (`CommitResources`), not transport.
2. Pure WASM payload copy/parse in the measured hydra fetch/build buckets is comparatively small.
3. “Mesh fully visible” is reached well before “joint UI ready”; tail latency mainly comes from post-load stage/joint readiness sequencing.

## Full `unitree_model` Load Sweep (8 models)
- `8/8` models reached all-mesh-ready + joint-panel-ready without console errors.
- Median:
  - first/all mesh ready: `2350.5 ms`
  - joint ready: `4443.5 ms`

Raw data: `output/bench/unitree_fullready_bench_20260223f.json`

## Truth Validation (Isaac Sim)
- Command: `python -u scripts/validate_unitree_collisions.py --server http://127.0.0.1:3004 --conda-env isaaclab22 --output-dir output/validation/unitree_collisions_20260223f`
- Result: `models=8, passed=8, failed=0`
- Coverage: collision, mesh, joint axis/limits, inertial mass/com/inertia axes

Summary: `output/validation/unitree_collisions_20260223f/summary.json`

## Material/Texture Console Check (8 models)
- Additional runtime sweep found:
  - `console error = 0`
  - no material/texture failure logs

## Cleanup
- Stopped temporary server process on port 3004.
- Ran `npm run cleanup` to terminate stale headless/debug browser processes.
