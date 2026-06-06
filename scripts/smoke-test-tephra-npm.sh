#!/usr/bin/env bash
# Smoke-test a packed `cesr-ts` npm artifact by installing the tarball into a
# fresh runtime and exercising the published package-level `tephra` CLI.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${ROOT_DIR}/packages/cesr/npm"
SAMPLES_DIR="${SAMPLES_DIR:-${ROOT_DIR}/samples}"
SAMPLE_STREAM_REL="${SAMPLE_STREAM_REL:-cesr-streams/CESR_1_0-oor-auth-vc.cesr}"

TARBALL_PATH="${1:-}"
if [[ -z "${TARBALL_PATH}" ]]; then
  echo "No tarball provided; building and packing cesr-ts..."
  (
    cd "${ROOT_DIR}/packages/cesr"
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

deno run --allow-run=tar --allow-read "${ROOT_DIR}/scripts/npm/assert-tarball-targets.ts" "${TARBALL_PATH}" --include-bin

TARBALL_DIR="$(cd "$(dirname "${TARBALL_PATH}")" && pwd)"
TARBALL_NAME="$(basename "${TARBALL_PATH}")"
SMOKE_NODE_IMAGE="${SMOKE_NODE_IMAGE:-node:alpine}"

echo "Running Docker smoke test with ${TARBALL_NAME} on ${SMOKE_NODE_IMAGE}"
docker run --rm \
  -e "SAMPLE_STREAM_REL=${SAMPLE_STREAM_REL}" \
  -e "SMOKE_NODE_IMAGE=${SMOKE_NODE_IMAGE}" \
  -v "${TARBALL_DIR}:/pkg" \
  -v "${SAMPLES_DIR}:/samples" \
  -v "${ROOT_DIR}/scripts/npm:/smoke-scripts:ro" \
  "${SMOKE_NODE_IMAGE}" /bin/sh /smoke-scripts/smoke-tephra-container.sh "/pkg/${TARBALL_NAME}"
