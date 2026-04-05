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
INSTALL_TARGETS="/pkg/${TARBALL_NAME}"

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
  INSTALL_TARGETS="${CESR_INSTALL_ARGS[0]} ${INSTALL_TARGETS}"
fi

DOCKER_ARGS=(
  -v "${TARBALL_DIR}:/pkg"
  -v "${SAMPLES_DIR}:/samples"
)
if (( ${#DOCKER_CESR_MOUNT[@]} > 0 )); then
  DOCKER_ARGS+=("${DOCKER_CESR_MOUNT[@]}")
fi

echo "Running Docker smoke test with ${TARBALL_NAME}"
# Use an isolated container so we validate the packed artifact's real install
# and CLI behavior, not the source tree or maintainer machine state.
docker run --rm \
  "${DOCKER_ARGS[@]}" \
  node:alpine /bin/ash -lc "
set -eu
npm install -g ${INSTALL_TARGETS} >/dev/null
V1=\$(tufa version | tr -d '\r')
V2=\$(tufa --version | tr -d '\r')
if [ \"\$V1\" != \"\$V2\" ]; then
  echo \"Version mismatch: tufa version=\$V1, tufa --version=\$V2\" >&2
  exit 1
fi
OUT=\$(tufa annotate --in /samples/${SAMPLE_STREAM_REL} | awk 'NR==1{print; exit}')
echo \"\$OUT\" | grep -q 'SERDER KERI JSON'
HEAD_DIR=/tmp/tufa-smoke
NAME=smoke-agent
ALIAS=smoke-agent
PORT=8711
PASSCODE=MyPasscodeARealSecret
tufa init --name \"\$NAME\" --head-dir \"\$HEAD_DIR\" --passcode \"\$PASSCODE\" --salt 0ADHFiisJ7FnfWkPl4YfX6AK >/dev/null
tufa incept --name \"\$NAME\" --head-dir \"\$HEAD_DIR\" --passcode \"\$PASSCODE\" --alias \"\$ALIAS\" --file /samples/incept-config/single-sig-incept.json --transferable >/dev/null
tufa agent --name \"\$NAME\" --head-dir \"\$HEAD_DIR\" -p \"\$PORT\" -P \"\$PASSCODE\" >/tmp/tufa-agent.log 2>&1 &
AGENT_PID=\$!
cleanup() {
  kill \"\$AGENT_PID\" >/dev/null 2>&1 || true
  wait \"\$AGENT_PID\" 2>/dev/null || true
}
trap cleanup EXIT
TUFA_SMOKE_PORT=\"\$PORT\" node --input-type=module -e '
  import { readFile } from \"node:fs/promises\";

  const url = \"http://127.0.0.1:\" + process.env.TUFA_SMOKE_PORT + \"/health\";
  let lastStatus = \"\";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      lastStatus = response.status + \" \" + text;
      if (response.ok && text === \"ok\") {
        process.exit(0);
      }
    } catch (error) {
      lastStatus = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  process.stderr.write(\"Health probe failed: \" + lastStatus + \"\\n\");
  process.stderr.write(await readFile(\"/tmp/tufa-agent.log\", \"utf8\"));
  process.exit(1);
' >/dev/null
echo \"Smoke test passed for tufa \$V1\"
"
