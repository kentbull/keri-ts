#!/usr/bin/env bash
# Smoke-test a packed `@keri-ts/tufa` npm artifact by installing the tarball
# into a fresh runtime and exercising the published CLI entrypoint.
# Optional additional args:
# - a locally built `cesr-ts` tarball
# - a locally built `keri-ts` tarball
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${ROOT_DIR}/packages/tufa/npm"
SAMPLES_DIR="${SAMPLES_DIR:-${ROOT_DIR}/samples}"
SAMPLE_STREAM_REL="${SAMPLE_STREAM_REL:-cesr-streams/CESR_1_0-oor-auth-vc.cesr}"

TARBALL_PATH="${1:-}"
CESR_TARBALL_PATH="${2:-}"
KERI_TARBALL_PATH="${3:-}"
if [[ -z "${TARBALL_PATH}" ]]; then
  echo "No tarball provided; building and packing @keri-ts/tufa..."
  (
    cd "${ROOT_DIR}/packages/tufa"
    deno task build:npm
  )
  TARBALL_NAME="$(cd "${PACKAGE_DIR}" && npm pack --silent | tail -n1)"
  TARBALL_PATH="${PACKAGE_DIR}/${TARBALL_NAME}"
fi

if [[ ! -f "${TARBALL_PATH}" ]]; then
  echo "Tarball not found: ${TARBALL_PATH}" >&2
  exit 1
fi

if [[ ! -f "${SAMPLES_DIR}/${SAMPLE_STREAM_REL}" ]]; then
  echo "Sample CESR stream not found: ${SAMPLES_DIR}/${SAMPLE_STREAM_REL}" >&2
  exit 1
fi

# setup-python exports LD_LIBRARY_PATH on Linux release runners; Deno rejects
# spawning tar with that inherited environment unless the variable is removed.
env -u LD_LIBRARY_PATH deno run --allow-run=tar --allow-read "${ROOT_DIR}/scripts/npm/assert-tarball-targets.ts" "${TARBALL_PATH}" --include-bin

TARBALL_DIR="$(cd "$(dirname "${TARBALL_PATH}")" && pwd)"
TARBALL_NAME="$(basename "${TARBALL_PATH}")"
INSTALL_TARGETS=("/pkg/${TARBALL_NAME}")
DOCKER_ARGS=(
  -v "${TARBALL_DIR}:/pkg"
  -v "${SAMPLES_DIR}:/samples"
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

if [[ -n "${KERI_TARBALL_PATH}" ]]; then
  if [[ ! -f "${KERI_TARBALL_PATH}" ]]; then
    echo "keri-ts tarball not found: ${KERI_TARBALL_PATH}" >&2
    exit 1
  fi

  KERI_TARBALL_DIR="$(cd "$(dirname "${KERI_TARBALL_PATH}")" && pwd)"
  KERI_TARBALL_NAME="$(basename "${KERI_TARBALL_PATH}")"
  DOCKER_ARGS+=(-v "${KERI_TARBALL_DIR}:/keri-pkg")
  INSTALL_TARGETS=("/keri-pkg/${KERI_TARBALL_NAME}" "${INSTALL_TARGETS[@]}")
fi

SMOKE_NODE_IMAGE="${SMOKE_NODE_IMAGE:-node:alpine}"

# Use a clean global install because Tufa's release contract is primarily the
# executable. Workspace imports are optional local tarballs, never symlinks.
echo "Running Docker smoke test with ${TARBALL_NAME} on ${SMOKE_NODE_IMAGE}"
docker run --rm \
  -e "SAMPLE_STREAM_REL=${SAMPLE_STREAM_REL}" \
  -e "SMOKE_NODE_IMAGE=${SMOKE_NODE_IMAGE}" \
  "${DOCKER_ARGS[@]}" \
  "${SMOKE_NODE_IMAGE}" /bin/sh /smoke-scripts/smoke-tufa-container.sh "${INSTALL_TARGETS[@]}"
