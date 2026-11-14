#!/usr/bin/env bash
# Smoke-test one packed @keri-ts library or service package (hosting, wallet, registrar, verifier, observer,
# multisync) the way a user installs it: the tarball alone in a fresh Node container, its internal
# dependencies from the npm registry at the exact versions it pins.
#
# Usage: smoke-test-package-npm.sh <package> <package.tgz> [local dependency .tgz...]
#   A release dry run passes locally built tarballs for pins npm does not have yet; they are installed beside
#   the package and satisfy those pins. SMOKE_NODE_IMAGE selects the Node image (default node:alpine).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE="${1:-}"
TARBALL_PATH="${2:-}"
if [[ -z "${PACKAGE}" || -z "${TARBALL_PATH}" ]]; then
  echo "Usage: $0 <package> <package.tgz> [local dependency .tgz...]" >&2
  exit 1
fi
shift 2

# 1. Every manifest target must be in the tarball before anything is installed.
# setup-python exports LD_LIBRARY_PATH on Linux release runners; Deno rejects
# spawning tar with that inherited environment unless the variable is removed.
env -u LD_LIBRARY_PATH deno run --allow-run=tar --allow-read "${ROOT_DIR}/scripts/npm/assert-tarball-targets.ts" "${TARBALL_PATH}"

# 2. Stage the tarballs in one directory the container mounts read-only.
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGE_DIR}"' EXIT
INSTALL_TARGETS=()
for tarball in "$@" "${TARBALL_PATH}"; do
  if [[ ! -f "${tarball}" ]]; then
    echo "Tarball not found: ${tarball}" >&2
    exit 1
  fi
  cp "${tarball}" "${STAGE_DIR}/"
  INSTALL_TARGETS+=("/pkg/$(basename "${tarball}")")
done

# 3. Install and probe in a clean container: no workspace symlinks, caches or host node_modules.
SMOKE_NODE_IMAGE="${SMOKE_NODE_IMAGE:-node:alpine}"
echo "Running Docker smoke test with $(basename "${TARBALL_PATH}") on ${SMOKE_NODE_IMAGE}"
docker run --rm \
  -e "SMOKE_NODE_IMAGE=${SMOKE_NODE_IMAGE}" \
  -v "${STAGE_DIR}:/pkg:ro" \
  -v "${ROOT_DIR}/scripts/npm:/smoke-scripts:ro" \
  "${SMOKE_NODE_IMAGE}" /bin/sh /smoke-scripts/smoke-package-container.sh "${PACKAGE}" "${INSTALL_TARGETS[@]}"
