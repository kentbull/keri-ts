#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${ROOT_DIR}/packages/keri/npm"
SAMPLES_DIR="${SAMPLES_DIR:-${ROOT_DIR}/samples}"
SAMPLE_STREAM_REL="${SAMPLE_STREAM_REL:-cesr-streams/CESR_1_0-oor-auth-vc.cesr}"

TARBALL_PATH="${1:-}"
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

if [[ ! -f "${SAMPLES_DIR}/${SAMPLE_STREAM_REL}" ]]; then
  echo "Sample CESR stream not found: ${SAMPLES_DIR}/${SAMPLE_STREAM_REL}" >&2
  exit 1
fi

TARBALL_DIR="$(cd "$(dirname "${TARBALL_PATH}")" && pwd)"
TARBALL_NAME="$(basename "${TARBALL_PATH}")"

echo "Running Docker smoke test with ${TARBALL_NAME}"
docker run --rm \
  -v "${TARBALL_DIR}:/pkg" \
  -v "${SAMPLES_DIR}:/samples" \
  node:alpine /bin/ash -lc "
set -eu
npm install -g /pkg/${TARBALL_NAME} >/dev/null
V1=\$(tufa version | tr -d '\r')
V2=\$(tufa --version | tr -d '\r')
if [ \"\$V1\" != \"\$V2\" ]; then
  echo \"Version mismatch: tufa version=\$V1, tufa --version=\$V2\" >&2
  exit 1
fi
OUT=\$(tufa annotate --in /samples/${SAMPLE_STREAM_REL} | awk 'NR==1{print; exit}')
echo \"\$OUT\" | grep -q 'SERDER KERI JSON'
echo \"Smoke test passed for tufa \$V1\"
"
