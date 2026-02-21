#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Speed-first OpenUSD WASM rebuild for usd-viewer.

Usage:
  scripts/rebuild-wasm-speed.sh --usd-repo <path> --build-dir <path> [options]

Required:
  --usd-repo <path>     OpenUSD repo root (must contain build_scripts/build_usd.py)
  --build-dir <path>    Build output directory used by build_usd.py

Optional:
  --emsdk-env <path>    Path to emsdk_env.sh (sourced before build)
  --dest-dir <path>     Destination for emHdBindings.* (default: ./usd-wasm/src/bindings)
  --debug               Build debug variant (default: release)
  --robot-trim          Trim non-robot plugins while keeping robot-critical
                        rendering/physics metadata behavior
  --size-opt            Prefer smaller wasm output (sets wasm-opt level to -Oz)
  --no-strip-debug      Keep DWARF/debug/producers metadata in wasm output
  --skip-wasm-opt       Skip wasm-opt speed pass
  --help                Show this help

Environment:
  JOBS=<n>              Parallel build workers (default: detected CPU cores)
  WASM_OPT_LEVEL=-O3    wasm-opt optimization level (default: -O3)

Example:
  scripts/rebuild-wasm-speed.sh \
    --emsdk-env ~/emsdk/emsdk_env.sh \
    --usd-repo ~/src/OpenUSD \
    --build-dir ~/build/openusd-wasm-speed
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

detect_cpu_count() {
  if command -v nproc >/dev/null 2>&1; then
    nproc
    return
  fi
  if command -v sysctl >/dev/null 2>&1; then
    sysctl -n hw.ncpu
    return
  fi
  echo 8
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PATCH_DIR="${ROOT_DIR}/public/patches"

USD_REPO=""
BUILD_DIR=""
EMSDK_ENV=""
DEST_DIR="${ROOT_DIR}/usd-wasm/src/bindings"
BUILD_VARIANT="release"
SKIP_WASM_OPT=0
WASM_OPT_LEVEL="${WASM_OPT_LEVEL:--O3}"
SIZE_OPT=0
ROBOT_TRIM=0
STRIP_DEBUG=1
JOBS="${JOBS:-$(detect_cpu_count)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --usd-repo)
      USD_REPO="${2:-}"
      shift 2
      ;;
    --build-dir)
      BUILD_DIR="${2:-}"
      shift 2
      ;;
    --emsdk-env)
      EMSDK_ENV="${2:-}"
      shift 2
      ;;
    --dest-dir)
      DEST_DIR="${2:-}"
      shift 2
      ;;
    --debug)
      BUILD_VARIANT="debug"
      shift
      ;;
    --robot-trim)
      ROBOT_TRIM=1
      shift
      ;;
    --size-opt)
      SIZE_OPT=1
      shift
      ;;
    --no-strip-debug)
      STRIP_DEBUG=0
      shift
      ;;
    --skip-wasm-opt)
      SKIP_WASM_OPT=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$USD_REPO" || -z "$BUILD_DIR" ]]; then
  usage
  exit 1
fi

if [[ "$SIZE_OPT" -eq 1 ]]; then
  WASM_OPT_LEVEL="-Oz"
fi

if [[ -n "$EMSDK_ENV" ]]; then
  if [[ ! -f "$EMSDK_ENV" ]]; then
    echo "emsdk env file not found: $EMSDK_ENV" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$EMSDK_ENV"
fi

if [[ -n "${EMSDK:-}" && -d "${EMSDK}/upstream/bin" ]]; then
  export PATH="${EMSDK}/upstream/bin:${PATH}"
fi

require_cmd python3
require_cmd patch
require_cmd emcc

if [[ "$SKIP_WASM_OPT" -eq 0 ]]; then
  require_cmd wasm-opt
fi

if [[ ! -f "${USD_REPO}/build_scripts/build_usd.py" ]]; then
  echo "Invalid usd repo path, missing build script: ${USD_REPO}/build_scripts/build_usd.py" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"
mkdir -p "$DEST_DIR"
BUILD_DIR="$(cd "$BUILD_DIR" && pwd)"
DEST_DIR="$(cd "$DEST_DIR" && pwd)"

export CMAKE_BUILD_PARALLEL_LEVEL="${JOBS}"
echo "[1/5] Building OpenUSD WASM (${BUILD_VARIANT}, jobs=${CMAKE_BUILD_PARALLEL_LEVEL})"
build_usd_script="${USD_REPO}/build_scripts/build_usd.py"
build_usd_runner_script="${build_usd_script}"

build_usd_args=(
  --build-target wasm
  --prefer-speed-over-safety
)
if [[ "$BUILD_VARIANT" == "debug" ]]; then
  build_usd_args+=(
    --build-variant debug
  )
fi

if [[ "$ROBOT_TRIM" -eq 1 ]]; then
  echo "  - robot-trim enabled: keeping JS bindings/WebGPU pipeline, trimming extra plugins"
  build_usd_args+=(
    --no-materialx
    --no-alembic
    --no-draco
    --no-openimageio
    --no-opencolorio
    --no-openvdb
    --no-ptex
    --no-embree
    --no-prman
  )
fi

python3 "${build_usd_runner_script}" "${build_usd_args[@]}" "$BUILD_DIR"

BIN_DIR="${BUILD_DIR}/bin"
for required_file in emHdBindings.js emHdBindings.wasm emHdBindings.worker.js emHdBindings.data; do
  if [[ ! -f "${BIN_DIR}/${required_file}" ]]; then
    echo "Build output missing: ${BIN_DIR}/${required_file}" >&2
    exit 1
  fi
done

if [[ -f "${BUILD_DIR}/build/OpenUSD/CMakeCache.txt" ]]; then
  echo "  - OpenUSD CMake feature flags:"
  grep -E 'PXR_ENABLE_WEBGPU_SUPPORT:BOOL=|PXR_PREFER_SAFETY_OVER_SPEED:BOOL=' "${BUILD_DIR}/build/OpenUSD/CMakeCache.txt" || true
fi

if [[ "$SKIP_WASM_OPT" -eq 0 ]]; then
  echo "[2/5] Running wasm-opt (${WASM_OPT_LEVEL})"
  wasm_opt_args=(
    "${WASM_OPT_LEVEL}"
    --enable-bulk-memory
    --enable-threads
    --enable-simd
  )
  if [[ "$STRIP_DEBUG" -eq 1 ]]; then
    wasm_opt_args+=(
      --strip-debug
      --strip-dwarf
      --strip-producers
    )
  fi
  wasm-opt \
    "${wasm_opt_args[@]}" \
    -o "${BIN_DIR}/emHdBindings.wasm" \
    "${BIN_DIR}/emHdBindings.wasm"
else
  echo "[2/5] Skipping wasm-opt"
fi

BINDINGS_JS="${BIN_DIR}/emHdBindings.js"

apply_patch_file() {
  local patch_file="$1"
  local label="$2"
  if [[ ! -f "$patch_file" ]]; then
    echo "  - skip ${label}: patch not found (${patch_file})"
    return
  fi
  if patch --batch --forward --silent "$BINDINGS_JS" < "$patch_file"; then
    echo "  - applied ${label}"
  else
    echo "  - skipped ${label} (already applied or no matching hunk)"
  fi
}

echo "[3/5] Applying JS compatibility patches"
apply_patch_file "${PATCH_DIR}/arguments_1.patch" "arguments_1"
apply_patch_file "${PATCH_DIR}/arguments_2.patch" "arguments_2"
apply_patch_file "${PATCH_DIR}/abort.patch" "abort"
apply_patch_file "${PATCH_DIR}/fileSystem.patch" "fileSystem"

python3 - "$BINDINGS_JS" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
changed = False

if "var getUsdModule = (() => {" in text:
    text = text.replace("var getUsdModule = (() => {", "var getUsdModule = ((args) => {", 1)
    changed = True

if "return function (moduleArg = {}) {" in text:
    text = text.replace(
        "return function (moduleArg = {}) {",
        """return function (
    moduleArg = {
      // module overrides can be supplied here
      locateFile: (path, prefix) => {
        if (!prefix && _scriptDir)
          prefix = _scriptDir.substr(0, _scriptDir.lastIndexOf("/") + 1);
        return prefix + path;
      },
      ...args,
      urlModifier: args?.urlModifier,
    },
  ) {""",
        1,
    )
    changed = True

old_abort = """      what = "Aborted(" + what + ")";
      err(what);
      ABORT = true;
"""
if old_abort in text and "// ABORT = true;" not in text:
    text = text.replace(
        old_abort,
        """      what = "Aborted(" + what + ")";
      err(what);
      // ABORT = true; // allow continued loading after one failed asset
""",
        1,
    )
    changed = True

if 'Module["FS_readdir"] = FS.readdir;' not in text and 'Module["PThread"] = PThread;' in text:
    text = text.replace(
        'Module["PThread"] = PThread;',
        """Module["PThread"] = PThread;
    Module["FS_readdir"] = FS.readdir;
    Module["FS_analyzePath"] = FS.analyzePath;""",
        1,
    )
    changed = True

if 'globalThis["NEEDLE:USD:GET"] = getUsdModule;' not in text:
    export_anchor = "if (typeof exports === 'object' && typeof module === 'object')"
    if export_anchor in text:
        text = text.replace(
            export_anchor,
            """if (typeof globalThis === 'object') globalThis["NEEDLE:USD:GET"] = getUsdModule;
""" + export_anchor,
            1,
        )
        changed = True

if changed:
    path.write_text(text, encoding="utf-8")
    print("  - applied fallback text patches")
else:
    print("  - fallback text patches not needed")
PY

echo "[4/5] Copying bindings into ${DEST_DIR}"
cp "${BIN_DIR}/emHdBindings.js" "${DEST_DIR}/emHdBindings.js"
cp "${BIN_DIR}/emHdBindings.wasm" "${DEST_DIR}/emHdBindings.wasm"
cp "${BIN_DIR}/emHdBindings.worker.js" "${DEST_DIR}/emHdBindings.worker.js"
cp "${BIN_DIR}/emHdBindings.data" "${DEST_DIR}/emHdBindings.data"

echo "[5/5] Done. Output sizes:"
ls -lh "${DEST_DIR}/emHdBindings.js" \
       "${DEST_DIR}/emHdBindings.wasm" \
       "${DEST_DIR}/emHdBindings.worker.js" \
       "${DEST_DIR}/emHdBindings.data"

report_transfer_size() {
  local file="$1"
  local raw_bytes
  raw_bytes="$(wc -c < "$file" | tr -d ' ')"
  if command -v gzip >/dev/null 2>&1; then
    local gzip_bytes
    gzip_bytes="$(gzip -9 -c "$file" | wc -c | tr -d ' ')"
    echo "  - $(basename "$file"): raw=${raw_bytes} bytes, gzip=${gzip_bytes} bytes"
  else
    echo "  - $(basename "$file"): raw=${raw_bytes} bytes"
  fi
}

echo "Transfer-size estimate (raw + gzip):"
report_transfer_size "${DEST_DIR}/emHdBindings.js"
report_transfer_size "${DEST_DIR}/emHdBindings.wasm"
report_transfer_size "${DEST_DIR}/emHdBindings.worker.js"
report_transfer_size "${DEST_DIR}/emHdBindings.data"

echo "Rebuild complete."
