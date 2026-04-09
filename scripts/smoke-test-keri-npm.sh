#!/usr/bin/env bash
# Smoke-test a packed `tufa` npm artifact by installing the tarball into a
# fresh runtime and exercising the published CLI entrypoint.
# Optional second arg:
# - a locally built `cesr-ts` tarball, so smoke tests validate the artifact pair
#   produced by this repo rather than whatever CESR version is on npm.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${ROOT_DIR}/packages/tufa/npm"
SAMPLES_DIR="${SAMPLES_DIR:-${ROOT_DIR}/samples}"
SAMPLE_STREAM_REL="${SAMPLE_STREAM_REL:-cesr-streams/CESR_1_0-oor-auth-vc.cesr}"

TARBALL_PATH="${1:-}"
CESR_TARBALL_PATH="${2:-}"
if [[ -z "${TARBALL_PATH}" ]]; then
  # Local fallback for manual use; CI normally passes an already packed tarball.
  echo "No tarball provided; building and packing tufa..."
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

SMOKE_NODE_IMAGE="${SMOKE_NODE_IMAGE:-node:alpine}"

echo "Running Docker smoke test with ${TARBALL_NAME} on ${SMOKE_NODE_IMAGE}"
# Use an isolated container so we validate the packed artifact's real install
# and CLI behavior, not the source tree or maintainer machine state.
docker run --rm \
  "${DOCKER_ARGS[@]}" \
  "${SMOKE_NODE_IMAGE}" /bin/sh -lc "
set -eu
log_agent() {
  echo '--- /tmp/tufa-agent.log ---' >&2
  if [ -f /tmp/tufa-agent.log ]; then
    if [ -s /tmp/tufa-agent.log ]; then
      cat /tmp/tufa-agent.log >&2
    else
      echo '<empty>' >&2
    fi
  else
    echo '<missing>' >&2
  fi
  echo '--- end /tmp/tufa-agent.log ---' >&2
}
log_agent_process() {
  echo '--- tufa-agent process ---' >&2
  echo "pid=\${AGENT_PID:-unset}" >&2
  if [ -n "\${AGENT_PID:-}" ] && kill -0 "\${AGENT_PID}" >/dev/null 2>&1; then
    echo 'state=running' >&2
  else
    echo 'state=exited' >&2
  fi
  if [ -f /tmp/tufa-agent.exitcode ]; then
    printf 'exit_code=' >&2
    tr -d '\r\n' </tmp/tufa-agent.exitcode >&2
    printf '\n' >&2
  else
    echo 'exit_code=unknown' >&2
  fi
  echo '--- end tufa-agent process ---' >&2
}
npm install -g ${INSTALL_TARGETS} >/dev/null
echo \"Node runtime: \$(node --version), npm: \$(npm --version)\" >&2
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
rm -f /tmp/tufa-agent.exitcode
(
  tufa agent --name \"\$NAME\" --head-dir \"\$HEAD_DIR\" -p \"\$PORT\" -P \"\$PASSCODE\" >/tmp/tufa-agent.log 2>&1
  status=\$?
  printf '%s\n' \"\$status\" >/tmp/tufa-agent.exitcode
  exit \"\$status\"
) &
AGENT_PID=\$!
cleanup() {
  status=\$?
  if kill -0 \"\$AGENT_PID\" >/dev/null 2>&1; then
    kill \"\$AGENT_PID\" >/dev/null 2>&1 || true
  fi
  wait \"\$AGENT_PID\" 2>/dev/null || true
  if [ \"\$status\" -ne 0 ]; then
    log_agent_process
    log_agent
  fi
}
trap cleanup EXIT
TUFA_SMOKE_PORT=\"\$PORT\" TUFA_SMOKE_AGENT_PID=\"\$AGENT_PID\" TUFA_SMOKE_AGENT_EXIT_FILE=\"/tmp/tufa-agent.exitcode\" node --input-type=module -e '
  import { readFile } from \"node:fs/promises\";
  import { setTimeout as delay } from \"node:timers/promises\";

  const url = \"http://127.0.0.1:\" + process.env.TUFA_SMOKE_PORT + \"/health\";
  const agentPid = Number(process.env.TUFA_SMOKE_AGENT_PID ?? \"0\");
  const agentExitFile = process.env.TUFA_SMOKE_AGENT_EXIT_FILE ?? \"\";
  let lastStatus = \"\";

  async function readExitCode() {
    if (!agentExitFile) return null;
    try {
      return (await readFile(agentExitFile, \"utf8\")).trim() || \"<empty>\";
    } catch {
      return null;
    }
  }

  function agentAlive() {
    if (!Number.isFinite(agentPid) || agentPid <= 0) {
      return true;
    }
    try {
      process.kill(agentPid, 0);
      return true;
    } catch {
      return false;
    }
  }

  for (let attempt = 0; attempt < 200; attempt += 1) {
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
    if (!agentAlive()) {
      const exitCode = await readExitCode();
      lastStatus += exitCode
        ? \" (agent exited with code \" + exitCode + \")\"
        : \" (agent exited)\";
      break;
    }
    await delay(100);
  }

  process.stderr.write(\"Health probe failed: \" + lastStatus + \"\\n\");
  process.stderr.write(
    \"Agent PID: \" + (Number.isFinite(agentPid) ? String(agentPid) : \"<unknown>\") + \"\\n\",
  );
  process.stderr.write(\"Agent alive: \" + (agentAlive() ? \"yes\" : \"no\") + \"\\n\");
  const exitCode = await readExitCode();
  process.stderr.write(\"Agent exit code: \" + (exitCode ?? \"<unknown>\") + \"\\n\");
  try {
    const log = await readFile(\"/tmp/tufa-agent.log\", \"utf8\");
    process.stderr.write(\"--- /tmp/tufa-agent.log ---\\n\");
    process.stderr.write(log.length > 0 ? log : \"<empty>\\n\");
    if (!log.endsWith(\"\\n\")) {
      process.stderr.write(\"\\n\");
    }
    process.stderr.write(\"--- end /tmp/tufa-agent.log ---\\n\");
  } catch (error) {
    process.stderr.write(\"Unable to read /tmp/tufa-agent.log: \" + String(error) + \"\\n\");
  }
  process.exit(1);
' >/dev/null
echo \"Smoke test passed for tufa \$V1 on ${SMOKE_NODE_IMAGE}\"
"
