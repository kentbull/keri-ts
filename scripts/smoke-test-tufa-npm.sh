#!/usr/bin/env bash
# Smoke-test a packed `@keri-ts/tufa` npm artifact by installing it into a fresh Node container and
# exercising the published CLI entrypoint and the installed packages it depends on.
#
# Usage: smoke-test-tufa-npm.sh [<tufa.tgz> [local dependency .tgz...]]
#   Tufa's internal dependencies come from the npm registry at the exact versions it pins, as users get
#   them. A release dry run passes locally built tarballs for pins npm does not have yet; they are installed
#   beside Tufa and satisfy those pins.
#   With no arguments the script builds and packs Tufa and every internal package it depends on from this
#   checkout, so a local run (`deno task smoke:tufa:npm`) exercises unreleased sources.
#   SMOKE_NODE_IMAGE selects the Node image (default node:alpine).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAMPLES_DIR="${SAMPLES_DIR:-${ROOT_DIR}/samples}"
SAMPLE_STREAM_REL="${SAMPLE_STREAM_REL:-cesr-streams/CESR_1_0-oor-auth-vc.cesr}"

pack() {
  # Build and pack one workspace package; prints the tarball path.
  local dir="${ROOT_DIR}/packages/$1"
  (cd "${dir}" && deno task build:npm >&2)
  printf '%s/npm/%s\n' "${dir}" "$(cd "${dir}/npm" && npm pack --silent | tail -n1)"
}

# 1. Select the Tufa tarball and any local dependency tarballs.
TARBALL_PATH="${1:-}"
LOCAL_DEPENDENCIES=()
if [[ -z "${TARBALL_PATH}" ]]; then
  echo "No tarball provided; building and packing @keri-ts/tufa and its internal dependencies..."
  for package in cesr keri hosting wallet registrar verifier observer; do
    LOCAL_DEPENDENCIES+=("$(pack "${package}")")
  done
  TARBALL_PATH="$(pack tufa)"
else
  shift
  LOCAL_DEPENDENCIES=("$@")
fi

if [[ ! -f "${SAMPLES_DIR}/${SAMPLE_STREAM_REL}" ]]; then
  echo "Sample CESR stream not found: ${SAMPLES_DIR}/${SAMPLE_STREAM_REL}" >&2
  exit 1
fi

# 2. Every manifest and bin target must be in the tarball before anything is installed.
# setup-python exports LD_LIBRARY_PATH on Linux release runners; Deno rejects
# spawning tar with that inherited environment unless the variable is removed.
env -u LD_LIBRARY_PATH deno run --allow-run=tar --allow-read "${ROOT_DIR}/scripts/npm/assert-tarball-targets.ts" "${TARBALL_PATH}" --include-bin

# 3. Stage the tarballs in one directory the container mounts read-only; Tufa is installed last.
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGE_DIR}"' EXIT
INSTALL_TARGETS=()
for tarball in ${LOCAL_DEPENDENCIES[@]+"${LOCAL_DEPENDENCIES[@]}"} "${TARBALL_PATH}"; do
  if [[ ! -f "${tarball}" ]]; then
    echo "Tarball not found: ${tarball}" >&2
    exit 1
  fi
  cp "${tarball}" "${STAGE_DIR}/"
  INSTALL_TARGETS+=("/pkg/$(basename "${tarball}")")
done

# 4. Install and run the CLI in a clean container: no workspace symlinks, caches or host node_modules.
SMOKE_NODE_IMAGE="${SMOKE_NODE_IMAGE:-node:alpine}"
echo "Running Docker smoke test with $(basename "${TARBALL_PATH}") on ${SMOKE_NODE_IMAGE}"
docker run --rm \
  -e "SAMPLE_STREAM_REL=${SAMPLE_STREAM_REL}" \
  -e "SMOKE_NODE_IMAGE=${SMOKE_NODE_IMAGE}" \
  -v "${STAGE_DIR}:/pkg:ro" \
  -v "${SAMPLES_DIR}:/samples" \
  -v "${ROOT_DIR}/scripts/npm:/smoke-scripts:ro" \
  "${SMOKE_NODE_IMAGE}" /bin/sh /smoke-scripts/smoke-tufa-container.sh "${INSTALL_TARGETS[@]}"
