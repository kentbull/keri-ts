#!/usr/bin/env bash
# Smoke-test the PR-built npm package set by installing cesr-ts, keri-ts, and
# @keri-ts/tufa once in a fresh Node container, then exercising both package
# boundaries against that shared install.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAMPLES_DIR="${SAMPLES_DIR:-${ROOT_DIR}/samples}"
SAMPLE_STREAM_REL="${SAMPLE_STREAM_REL:-cesr-streams/CESR_1_0-oor-auth-vc.cesr}"

KERI_TARBALL_PATH="${1:-}"
CESR_TARBALL_PATH="${2:-}"
TUFA_TARBALL_PATH="${3:-}"

if [[ -z "${KERI_TARBALL_PATH}" || -z "${CESR_TARBALL_PATH}" || -z "${TUFA_TARBALL_PATH}" ]]; then
  echo "Usage: $0 <keri-ts.tgz> <cesr-ts.tgz> <keri-ts-tufa.tgz>" >&2
  exit 1
fi

for tarball in "${KERI_TARBALL_PATH}" "${CESR_TARBALL_PATH}" "${TUFA_TARBALL_PATH}"; do
  if [[ ! -f "${tarball}" ]]; then
    echo "Tarball not found: ${tarball}" >&2
    exit 1
  fi
done

if [[ ! -f "${SAMPLES_DIR}/${SAMPLE_STREAM_REL}" ]]; then
  echo "Sample CESR stream not found: ${SAMPLES_DIR}/${SAMPLE_STREAM_REL}" >&2
  exit 1
fi

deno run --allow-run=tar --allow-read "${ROOT_DIR}/scripts/npm/assert-tarball-targets.ts" "${KERI_TARBALL_PATH}"
deno run --allow-run=tar --allow-read "${ROOT_DIR}/scripts/npm/assert-tarball-targets.ts" "${TUFA_TARBALL_PATH}" --include-bin

KERI_TARBALL_DIR="$(cd "$(dirname "${KERI_TARBALL_PATH}")" && pwd)"
KERI_TARBALL_NAME="$(basename "${KERI_TARBALL_PATH}")"
CESR_TARBALL_DIR="$(cd "$(dirname "${CESR_TARBALL_PATH}")" && pwd)"
CESR_TARBALL_NAME="$(basename "${CESR_TARBALL_PATH}")"
TUFA_TARBALL_DIR="$(cd "$(dirname "${TUFA_TARBALL_PATH}")" && pwd)"
TUFA_TARBALL_NAME="$(basename "${TUFA_TARBALL_PATH}")"
SMOKE_NODE_IMAGE="${SMOKE_NODE_IMAGE:-node:alpine}"

echo "Running combined Docker smoke test on ${SMOKE_NODE_IMAGE}"
docker run --rm \
  -e "SAMPLE_STREAM_REL=${SAMPLE_STREAM_REL}" \
  -e "SMOKE_NODE_IMAGE=${SMOKE_NODE_IMAGE}" \
  -v "${KERI_TARBALL_DIR}:/keri-pkg" \
  -v "${CESR_TARBALL_DIR}:/cesr-pkg" \
  -v "${TUFA_TARBALL_DIR}:/tufa-pkg" \
  -v "${SAMPLES_DIR}:/samples" \
  -v "${ROOT_DIR}/scripts/npm:/smoke-scripts:ro" \
  "${SMOKE_NODE_IMAGE}" /bin/sh /smoke-scripts/smoke-pr-packages-container.sh \
    "/cesr-pkg/${CESR_TARBALL_NAME}" \
    "/keri-pkg/${KERI_TARBALL_NAME}" \
    "/tufa-pkg/${TUFA_TARBALL_NAME}"
