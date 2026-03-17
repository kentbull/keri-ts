#!/usr/bin/env bash
# Smoke-test a packed `keri-ts` npm artifact by installing the tarball into a
# fresh runtime and exercising the published CLI entrypoint.
# Optional second arg:
# - a locally built `cesr-ts` tarball, so smoke tests validate the artifact pair
#   produced by this repo rather than whatever CESR version is on npm.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${ROOT_DIR}/packages/keri/npm"
SAMPLES_DIR="${SAMPLES_DIR:-${ROOT_DIR}/samples}"
SAMPLE_STREAM_REL="${SAMPLE_STREAM_REL:-cesr-streams/CESR_1_0-oor-auth-vc.cesr}"

TARBALL_PATH="${1:-}"
CESR_TARBALL_PATH="${2:-}"
if [[ -z "${TARBALL_PATH}" ]]; then
  # Local fallback for manual use; CI normally passes an already packed tarball.
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
CESR_INSTALL_ARGS=()
DOCKER_CESR_MOUNT=()

if [[ -n "${CESR_TARBALL_PATH}" ]]; then
  if [[ ! -f "${CESR_TARBALL_PATH}" ]]; then
    echo "CESR tarball not found: ${CESR_TARBALL_PATH}" >&2
    exit 1
  fi

  CESR_TARBALL_DIR="$(cd "$(dirname "${CESR_TARBALL_PATH}")" && pwd)"
  CESR_TARBALL_NAME="$(basename "${CESR_TARBALL_PATH}")"
  # Installing the locally built CESR tarball avoids a subtle false-positive:
  # `keri-ts` could pass against the old npm-published CESR while the PR's new
  # pair of artifacts is actually incompatible.
  CESR_INSTALL_ARGS=("/cesr-pkg/${CESR_TARBALL_NAME}")
  DOCKER_CESR_MOUNT=(-v "${CESR_TARBALL_DIR}:/cesr-pkg")
fi

echo "Running Docker smoke test with ${TARBALL_NAME}"
# Use an isolated container so we validate the packed artifact's real install
# and CLI behavior, not the source tree or maintainer machine state.
docker run --rm \
  -v "${TARBALL_DIR}:/pkg" \
  "${DOCKER_CESR_MOUNT[@]}" \
  -v "${SAMPLES_DIR}:/samples" \
  node:alpine /bin/ash -lc "
set -eu
npm install -g ${CESR_INSTALL_ARGS[*]} /pkg/${TARBALL_NAME} >/dev/null
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
