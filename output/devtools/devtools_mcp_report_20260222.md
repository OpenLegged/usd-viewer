# DevTools MCP Native Check Report (2026-02-22)

- Generated UTC: 2026-02-22T14:26:07Z
- Server: http://127.0.0.1:3003
- Toolchain: `mcp__chrome-devtools__*` (native Chrome DevTools MCP)
- Scope: `g1_29dof`, `go2`

## MCP Recovery

- `chrome-devtools` MCP was restored and became callable (`list_pages` returned live page list).
- Active process confirmed:
  - `node ... chrome-devtools-mcp --headless --isolated --executablePath /usr/bin/google-chrome`

## Model A: G1 29DoF

- URL:
  - `http://127.0.0.1:3003/?file=/unitree_model/G1/29dof/usd/g1_29dof_rev_1_0/g1_29dof_rev_1_0.usd&showVisuals=1&showCollisions=1&showDynamics=1&showRobotInspector=1&readStageMetadata=1&cb=20260222-devtools-g1`
- Page status:
  - `document.readyState = complete`
  - message log: `Loaded 68 meshes (visual: 35, collision: 33).`
- Screenshot:
  - `output/devtools/g1_29dof_viewer.png`

### Console Panel (itemized)

1. `warn` GPU stall due to `ReadPixels` (msgid=4)
2. `warn` GPU stall due to `ReadPixels` (msgid=5)
3. `warn` GPU stall due to `ReadPixels` no longer repeats (msgid=6)

- Error level (`console.error`): none

### Network Panel (itemized)

- Total requests listed: 77
- Status distribution seen in panel list: only `200`
- 4xx/5xx: none
- Request-failed (transport): none

## Model B: Go2

- URL:
  - `http://127.0.0.1:3003/?file=/unitree_model/Go2/usd/go2.usd&showVisuals=1&showCollisions=1&showDynamics=1&showRobotInspector=1&readStageMetadata=1&cb=20260222-devtools-go2`
- Page status:
  - `document.readyState = complete`
  - message log: `Loaded 44 meshes (visual: 17, collision: 27).`
- Screenshot:
  - `output/devtools/go2_viewer.png`

### Console Panel (itemized)

- No console messages.
- Error level (`console.error`): none

### Network Panel (itemized)

- Total requests listed: 76
- Status distribution seen in panel list: `200` and `304` only
- 4xx/5xx: none
- Request-failed (transport): none

Notes on `304` rows:

1. `304 Not Modified` entries are cache revalidation hits (e.g. `css/styles.css`, `index.js`, viewer modules).
2. These are expected in repeated-load checks and are not network failures.
3. MCP list view labels them as `failed - 304`, but header/body inspection confirms normal cache semantics.

Evidence sample:

- `reqid=2` (`/css/styles.css`) includes `if-none-match`/`if-modified-since`, response `etag`/`last-modified`, status `304`.

## Final Verdict

1. `g1_29dof`: no new Console error; Network has no 4xx/5xx and no transport failure.
2. `go2`: no Console message/error; Network has no 4xx/5xx and no transport failure; 304 entries are expected cache behavior.
3. This DevTools pass does not indicate new regressions in runtime Console/Network health.
