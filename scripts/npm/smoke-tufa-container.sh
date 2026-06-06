#!/usr/bin/env sh
set -eu

log_agent() {
  echo "--- /tmp/tufa-agent.log ---" >&2
  if [ -f /tmp/tufa-agent.log ]; then
    if [ -s /tmp/tufa-agent.log ]; then
      cat /tmp/tufa-agent.log >&2
    else
      echo "<empty>" >&2
    fi
  else
    echo "<missing>" >&2
  fi
  echo "--- end /tmp/tufa-agent.log ---" >&2
}

log_agent_process() {
  echo "--- tufa-agent process ---" >&2
  echo "pid=${AGENT_PID:-unset}" >&2
  if [ -n "${AGENT_PID:-}" ] && kill -0 "${AGENT_PID}" >/dev/null 2>&1; then
    echo "state=running" >&2
  else
    echo "state=exited" >&2
  fi
  if [ -f /tmp/tufa-agent.exitcode ]; then
    printf "exit_code=" >&2
    tr -d "\r\n" </tmp/tufa-agent.exitcode >&2
    printf "\n" >&2
  else
    echo "exit_code=unknown" >&2
  fi
  echo "--- end tufa-agent process ---" >&2
}

npm install -g "$@" >/dev/null
echo "Node runtime: $(node --version), npm: $(npm --version)" >&2
V1="$(tufa version | tr -d "\r")"
V2="$(tufa --version | tr -d "\r")"
if [ "${V1}" != "${V2}" ]; then
  echo "Version mismatch: tufa version=${V1}, tufa --version=${V2}" >&2
  exit 1
fi

OUT="$(tufa annotate --in "/samples/${SAMPLE_STREAM_REL}" | awk "NR==1{print; exit}")"
echo "${OUT}" | grep -q "SERDER KERI JSON"

HEAD_DIR=/tmp/tufa-smoke
NAME=smoke-agent
ALIAS=smoke-agent
PORT=8711
PASSCODE=MyPasscodeARealSecret
tufa init --name "${NAME}" --head-dir "${HEAD_DIR}" --passcode "${PASSCODE}" --salt 0ADHFiisJ7FnfWkPl4YfX6AK >/dev/null
tufa incept --name "${NAME}" --head-dir "${HEAD_DIR}" --passcode "${PASSCODE}" --alias "${ALIAS}" --file /samples/incept-config/single-sig-incept.json --transferable >/dev/null
rm -f /tmp/tufa-agent.exitcode
(
  tufa agent --name "${NAME}" --head-dir "${HEAD_DIR}" -p "${PORT}" -P "${PASSCODE}" >/tmp/tufa-agent.log 2>&1
  status=$?
  printf "%s\n" "${status}" >/tmp/tufa-agent.exitcode
  exit "${status}"
) &
AGENT_PID=$!

cleanup() {
  status=$?
  if kill -0 "${AGENT_PID}" >/dev/null 2>&1; then
    kill "${AGENT_PID}" >/dev/null 2>&1 || true
  fi
  wait "${AGENT_PID}" 2>/dev/null || true
  if [ "${status}" -ne 0 ]; then
    log_agent_process
    log_agent
  fi
}
trap cleanup EXIT

TUFA_SMOKE_PORT="${PORT}" \
  TUFA_SMOKE_AGENT_PID="${AGENT_PID}" \
  TUFA_SMOKE_AGENT_EXIT_FILE="/tmp/tufa-agent.exitcode" \
  TUFA_SMOKE_AGENT_LOG="/tmp/tufa-agent.log" \
  node /smoke-scripts/wait-for-tufa-health.mjs >/dev/null

echo "Smoke test passed for @keri-ts/tufa ${V1} on ${SMOKE_NODE_IMAGE:-node}"
