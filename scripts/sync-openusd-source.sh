#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_DIR="${HOME}/.localdeps/OpenUSD"
DEST_DIR="${REPO_ROOT}/third_party/OpenUSD"
ENABLE_DELETE=0
LINK_AT_REPO_ROOT=1

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Sync OpenUSD source into this repository.

Options:
  --source <path>       OpenUSD source path (default: ~/.localdeps/OpenUSD)
  --dest <path>         Destination path in repo (default: third_party/OpenUSD)
  --delete              Delete files in destination not present in source
  --no-link             Do not update repo-root OpenUSD symlink
  -h, --help            Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      SOURCE_DIR="$2"
      shift 2
      ;;
    --dest)
      DEST_DIR="$2"
      shift 2
      ;;
    --delete)
      ENABLE_DELETE=1
      shift
      ;;
    --no-link)
      LINK_AT_REPO_ROOT=0
      shift
      ;;
    -h|--help)
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

SOURCE_DIR="$(realpath -m "${SOURCE_DIR}")"
DEST_DIR="$(realpath -m "${DEST_DIR}")"

if [[ ! -d "${SOURCE_DIR}" ]]; then
  echo "Source directory does not exist: ${SOURCE_DIR}" >&2
  exit 1
fi

mkdir -p "${DEST_DIR}"

RSYNC_ARGS=(
  -a
  --info=progress2
  --exclude=.git
  --exclude=.github
  --exclude=.cache
  --exclude=build
  --exclude=build-*
  --exclude=out
)

if [[ ${ENABLE_DELETE} -eq 1 ]]; then
  RSYNC_ARGS+=(--delete)
fi

echo "[sync-openusd] source: ${SOURCE_DIR}"
echo "[sync-openusd] dest:   ${DEST_DIR}"

rsync "${RSYNC_ARGS[@]}" "${SOURCE_DIR}/" "${DEST_DIR}/"

if [[ ${LINK_AT_REPO_ROOT} -eq 1 ]]; then
  ln -sfn "third_party/OpenUSD" "${REPO_ROOT}/OpenUSD"
  echo "[sync-openusd] updated symlink: ${REPO_ROOT}/OpenUSD -> third_party/OpenUSD"
fi

echo "[sync-openusd] done"
