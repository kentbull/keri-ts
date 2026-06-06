#!/usr/bin/env bash
# Smoke-test a packed `keri-ts` npm library artifact by installing the tarball
# into a fresh runtime and verifying only the supported library entrypoints are
# public.
# Optional second arg:
# - a locally built `cesr-ts` tarball, so smoke tests validate the artifact pair
#   produced by this repo rather than whatever CESR version is on npm.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${ROOT_DIR}/packages/keri/npm"

TARBALL_PATH="${1:-}"
CESR_TARBALL_PATH="${2:-}"
if [[ -z "${TARBALL_PATH}" ]]; then
  echo "No tarball provided; building and packing keri-ts..."
  (
    cd "${ROOT_DIR}/packages/keri"
    deno task build:npm
  )
  TARBALL_NAME="$(cd "${PACKAGE_DIR}" && npm pack --silent | tail -n1)"
  TARBALL_PATH="${PACKAGE_DIR}/${TARBALL_NAME}"
fi

if [[ ! -f "${TARBALL_PATH}" ]]; then
  echo "Tarball not found: ${TARBALL_PATH}" >&2
  exit 1
fi

# setup-python exports LD_LIBRARY_PATH on Linux release runners; Deno rejects
# spawning tar with that inherited environment unless the variable is removed.
env -u LD_LIBRARY_PATH deno run --allow-run=tar --allow-read "${ROOT_DIR}/scripts/npm/assert-tarball-targets.ts" "${TARBALL_PATH}"

TARBALL_DIR="$(cd "$(dirname "${TARBALL_PATH}")" && pwd)"
TARBALL_NAME="$(basename "${TARBALL_PATH}")"
INSTALL_TARGETS=("/pkg/${TARBALL_NAME}")
DOCKER_ARGS=(
  -v "${TARBALL_DIR}:/pkg"
  -v "${ROOT_DIR}/scripts/npm:/smoke-scripts:ro"
)

if [[ -n "${CESR_TARBALL_PATH}" ]]; then
  if [[ ! -f "${CESR_TARBALL_PATH}" ]]; then
    echo "CESR tarball not found: ${CESR_TARBALL_PATH}" >&2
    exit 1
  fi

  CESR_TARBALL_DIR="$(cd "$(dirname "${CESR_TARBALL_PATH}")" && pwd)"
  CESR_TARBALL_NAME="$(basename "${CESR_TARBALL_PATH}")"
  DOCKER_ARGS+=(-v "${CESR_TARBALL_DIR}:/cesr-pkg")
  INSTALL_TARGETS=("/cesr-pkg/${CESR_TARBALL_NAME}" "${INSTALL_TARGETS[@]}")
fi

SMOKE_NODE_IMAGE="${SMOKE_NODE_IMAGE:-node:alpine}"

# Use a clean container install so the smoke test exercises the packed npm
# artifact and optional local CESR tarball, not workspace symlinks or caches.
echo "Running Docker smoke test with ${TARBALL_NAME} on ${SMOKE_NODE_IMAGE}"
docker run --rm \
  -e "SMOKE_NODE_IMAGE=${SMOKE_NODE_IMAGE}" \
  "${DOCKER_ARGS[@]}" \
  "${SMOKE_NODE_IMAGE}" /bin/sh /smoke-scripts/smoke-keri-container.sh "${INSTALL_TARGETS[@]}"
