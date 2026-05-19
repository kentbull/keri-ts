#!/usr/bin/env bash
# End-to-end smoke for the user-facing Gate E CLI slice.
#
# Important boundary:
# - this script exercises the CLI and protocol HTTP surfaces directly
# - it does not use `deno eval` or other arbitrary TypeScript helpers to seed
#   or inspect LMDB state
# - deeper DB/runtime assertions belong in the repo's Deno test suite or a
#   future read-only CLI inspection command
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v deno >/dev/null 2>&1; then
  echo "deno is required" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

PASSCODE="${GATE_E_PASSCODE:-MyPasscodeARealSecret}"
SALT="${GATE_E_SALT:-0ADHFiisJ7FnfWkPl4YfX6AK}"
KEEP_TMP="${KEEP_TMP:-0}"
PORT="${GATE_E_PORT:-$((8800 + RANDOM % 400))}"
BASE_URL="http://127.0.0.1:${PORT}"
TARGET_PORT="${GATE_E_TARGET_PORT:-$((PORT + 1))}"
TARGET_BASE_URL="http://127.0.0.1:${TARGET_PORT}"

TEMP_ROOT="${GATE_E_TMPDIR:-$(mktemp -d "${TMPDIR:-/tmp}/keri-ts-gate-e.XXXXXX")}"
LOG_DIR="${TEMP_ROOT}/logs"
SOURCE_HEAD="${TEMP_ROOT}/source-head"
TARGET_HEAD="${TEMP_ROOT}/target-head"
CFG_INIT_HEAD="${TEMP_ROOT}/cfg-init-head"
CFG_INIT_DIR="${TEMP_ROOT}/cfg-init-dir"
CFG_INCEPT_HEAD="${TEMP_ROOT}/cfg-incept-head"
CFG_INCEPT_DIR="${TEMP_ROOT}/cfg-incept-dir"
mkdir -p "${LOG_DIR}" "${SOURCE_HEAD}" "${TARGET_HEAD}" "${CFG_INIT_HEAD}" "${CFG_INIT_DIR}" "${CFG_INCEPT_HEAD}" "${CFG_INCEPT_DIR}"

SOURCE_NAME="gate-e-source"
SOURCE_ALIAS="alice"
TARGET_NAME="gate-e-target"
TARGET_ALIAS="bob"
CFG_INIT_NAME="gate-e-config-init"
CFG_INCEPT_NAME="gate-e-config-incept"
CFG_INCEPT_ALIAS="config-incept"
CFG_FILE_NAME="gate-e-bootstrap"

SOURCE_AGENT_LOG="${LOG_DIR}/source-agent.log"
SOURCE_AGENT_PID=""
TARGET_AGENT_LOG="${LOG_DIR}/target-agent.log"
TARGET_AGENT_PID=""

TUFA=(deno run --allow-all --unstable-ffi packages/tufa/mod.ts)

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

cleanup() {
  stop_source_host
  stop_target_host

  if [[ "${KEEP_TMP}" == "1" ]]; then
    echo "Keeping temp files at ${TEMP_ROOT}"
  else
    rm -rf "${TEMP_ROOT}"
  fi
}
trap cleanup EXIT

run_tufa() {
  "${TUFA[@]}" "$@"
}

capture_tufa() {
  run_tufa "$@" 2>&1
}

extract_prefix() {
  local output="$1"
  local pre
  pre="$(printf '%s\n' "${output}" | awk '/^Prefix/{print $2; exit}')"
  [[ -n "${pre}" ]] || fail "could not extract prefix from output: ${output}"
  printf '%s\n' "${pre}"
}

last_non_empty_line() {
  local output="$1"
  printf '%s\n' "${output}" | awk 'NF{line=$0} END{print line}'
}

assert_status() {
  local expected="$1"
  local url="$2"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "${url}" || true)"
  [[ "${code}" == "${expected}" ]] || fail "expected ${url} to return ${expected}, got ${code}"
}

wait_for_health() {
  local base_url="$1"
  local log_file="$2"
  local url="${base_url}/health"
  local body=""

  for _ in $(seq 1 100); do
    body="$(curl -fsS "${url}" 2>/dev/null || true)"
    if [[ "${body}" == "ok" ]]; then
      return
    fi
    sleep 0.1
  done

  echo "Agent log:" >&2
  cat "${log_file}" >&2 || true
  fail "agent never became healthy at ${url}"
}

write_config() {
  local head_dir="$1"
  local file_name="$2"
  local iurl="$3"
  local durl="$4"
  local wurl="$5"

  mkdir -p "${head_dir}/.tufa/cf"
  cat > "${head_dir}/.tufa/cf/${file_name}.json" <<EOF
{
  "dt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "iurls": ["${iurl}"],
  "durls": ["${durl}"],
  "wurls": ["${wurl}"]
}
EOF
}

assert_line_equals() {
  local actual="$1"
  local expected="$2"
  [[ "${actual}" == "${expected}" ]] || fail "expected '${expected}', got '${actual}'"
}

assert_line_contains() {
  local actual="$1"
  local expected="$2"
  [[ "${actual}" == *"${expected}"* ]] || fail "expected '${actual}' to contain '${expected}'"
}

capture_challenge_words() {
  local out_format="$1"
  last_non_empty_line "$(capture_tufa challenge generate --strength 128 --out "${out_format}")"
}

kill_port_listener() {
  local port="$1"
  local pids

  pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  if [[ -z "${pids}" ]]; then
    return
  fi

  # shellcheck disable=SC2086
  kill ${pids} >/dev/null 2>&1 || true
  sleep 0.2
}

start_source_host() {
  if [[ -n "${SOURCE_AGENT_PID}" ]] && kill -0 "${SOURCE_AGENT_PID}" >/dev/null 2>&1; then
    return
  fi

  kill_port_listener "${PORT}"
  run_tufa agent --name "${SOURCE_NAME}" --head-dir "${SOURCE_HEAD}" --passcode "${PASSCODE}" --port "${PORT}" >"${SOURCE_AGENT_LOG}" 2>&1 &
  SOURCE_AGENT_PID="$!"
  wait_for_health "${BASE_URL}" "${SOURCE_AGENT_LOG}"
}

stop_source_host() {
  if [[ -z "${SOURCE_AGENT_PID}" ]]; then
    return
  fi

  kill "${SOURCE_AGENT_PID}" >/dev/null 2>&1 || true
  wait "${SOURCE_AGENT_PID}" 2>/dev/null || true
  SOURCE_AGENT_PID=""
  kill_port_listener "${PORT}"
}

start_target_host() {
  if [[ -n "${TARGET_AGENT_PID}" ]] && kill -0 "${TARGET_AGENT_PID}" >/dev/null 2>&1; then
    return
  fi

  kill_port_listener "${TARGET_PORT}"
  run_tufa agent --name "${TARGET_NAME}" --head-dir "${TARGET_HEAD}" --passcode "${PASSCODE}" --port "${TARGET_PORT}" >"${TARGET_AGENT_LOG}" 2>&1 &
  TARGET_AGENT_PID="$!"
  wait_for_health "${TARGET_BASE_URL}" "${TARGET_AGENT_LOG}"
}

stop_target_host() {
  if [[ -z "${TARGET_AGENT_PID}" ]]; then
    return
  fi

  kill "${TARGET_AGENT_PID}" >/dev/null 2>&1 || true
  wait "${TARGET_AGENT_PID}" 2>/dev/null || true
  TARGET_AGENT_PID=""
  kill_port_listener "${TARGET_PORT}"
}

log "Using temp root ${TEMP_ROOT}"

# -----------------------------------------------------------------------------
# Source controller setup
# -----------------------------------------------------------------------------
log "Provision source store and identifiers"
run_tufa init \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --salt "${SALT}" \
  >/dev/null

SOURCE_INCEPT_OUTPUT="$(capture_tufa incept \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${SOURCE_ALIAS}" \
  --transferable \
  --isith 1 \
  --icount 1 \
  --nsith 1 \
  --ncount 1 \
  --toad 0)"
SOURCE_PRE="$(extract_prefix "${SOURCE_INCEPT_OUTPUT}")"

log "Drive runtime-backed loc add and ends add"
LOC_OUTPUT="$(capture_tufa loc add \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${SOURCE_ALIAS}" \
  --url "${BASE_URL}")"
MAILBOX_ENDS_OUTPUT="$(capture_tufa ends add \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${SOURCE_ALIAS}" \
  --role mailbox \
  --eid "${SOURCE_PRE}")"
AGENT_ENDS_OUTPUT="$(capture_tufa ends add \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${SOURCE_ALIAS}" \
  --role agent \
  --eid "${SOURCE_PRE}")"
assert_line_equals "$(last_non_empty_line "${LOC_OUTPUT}")" "Location ${BASE_URL} added for aid ${SOURCE_PRE} with scheme http"
assert_line_equals "$(last_non_empty_line "${MAILBOX_ENDS_OUTPUT}")" "mailbox ${SOURCE_PRE}"
assert_line_equals "$(last_non_empty_line "${AGENT_ENDS_OUTPUT}")" "agent ${SOURCE_PRE}"

log "Start long-lived tufa agent host"
start_source_host

log "Verify protocol-only host surface"
assert_status 200 "${BASE_URL}/health"
assert_status 200 "${BASE_URL}/oobi/${SOURCE_PRE}/controller"
assert_status 200 "${BASE_URL}/oobi/${SOURCE_PRE}/mailbox/${SOURCE_PRE}"
assert_status 200 "${BASE_URL}/oobi/${SOURCE_PRE}/agent/${SOURCE_PRE}"
assert_status 404 "${BASE_URL}/admin"
assert_status 404 "${BASE_URL}/admin/queue"
assert_status 404 "${BASE_URL}/rpc"
assert_status 404 "${BASE_URL}/control"

log "Generate controller, mailbox, and agent OOBIs"
CONTROLLER_OOBI_OUTPUT="$(capture_tufa oobi generate \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${SOURCE_ALIAS}" \
  --role controller)"
MAILBOX_OOBI_OUTPUT="$(capture_tufa oobi generate \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${SOURCE_ALIAS}" \
  --role mailbox)"
AGENT_OOBI_OUTPUT="$(capture_tufa oobi generate \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${SOURCE_ALIAS}" \
  --role agent)"
CONTROLLER_OOBI="$(last_non_empty_line "${CONTROLLER_OOBI_OUTPUT}")"
MAILBOX_OOBI="$(last_non_empty_line "${MAILBOX_OOBI_OUTPUT}")"
AGENT_OOBI="$(last_non_empty_line "${AGENT_OOBI_OUTPUT}")"

[[ "${CONTROLLER_OOBI}" == "${BASE_URL}/oobi/${SOURCE_PRE}/controller" ]] || fail "unexpected controller OOBI ${CONTROLLER_OOBI}"
[[ "${MAILBOX_OOBI}" == "${BASE_URL}/oobi/${SOURCE_PRE}/mailbox/${SOURCE_PRE}" ]] || fail "unexpected mailbox OOBI ${MAILBOX_OOBI}"
[[ "${AGENT_OOBI}" == "${BASE_URL}/oobi/${SOURCE_PRE}/agent/${SOURCE_PRE}" ]] || fail "unexpected agent OOBI ${AGENT_OOBI}"

# -----------------------------------------------------------------------------
# Target controller setup
# -----------------------------------------------------------------------------
log "Resolve generated OOBIs into a second controller store"
run_tufa init \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --salt "${SALT}" \
  >/dev/null
CONTROLLER_RESOLVE_OUTPUT="$(capture_tufa oobi resolve \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --url "${CONTROLLER_OOBI}" \
  --oobi-alias "${SOURCE_ALIAS}")"
MAILBOX_RESOLVE_OUTPUT="$(capture_tufa oobi resolve \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --url "${MAILBOX_OOBI}" \
  --oobi-alias "${SOURCE_ALIAS}")"
AGENT_RESOLVE_OUTPUT="$(capture_tufa oobi resolve \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --url "${AGENT_OOBI}" \
  --oobi-alias "${SOURCE_ALIAS}")"
assert_line_equals "$(last_non_empty_line "${CONTROLLER_RESOLVE_OUTPUT}")" "${CONTROLLER_OOBI}"
assert_line_equals "$(last_non_empty_line "${MAILBOX_RESOLVE_OUTPUT}")" "${MAILBOX_OOBI}"
assert_line_equals "$(last_non_empty_line "${AGENT_RESOLVE_OUTPUT}")" "${AGENT_OOBI}"
TARGET_INCEPT_OUTPUT="$(capture_tufa incept \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${TARGET_ALIAS}" \
  --transferable \
  --isith 1 \
  --icount 1 \
  --nsith 1 \
  --ncount 1 \
  --toad 0)"
TARGET_PRE="$(extract_prefix "${TARGET_INCEPT_OUTPUT}")"
assert_line_equals \
  "$(last_non_empty_line "$(capture_tufa aid \
    --name "${TARGET_NAME}" \
    --head-dir "${TARGET_HEAD}" \
    --passcode "${PASSCODE}" \
    --alias "${TARGET_ALIAS}")")" \
  "${TARGET_PRE}"

log "Drive runtime-backed loc add and ends add for the target controller"
TARGET_LOC_OUTPUT="$(capture_tufa loc add \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${TARGET_ALIAS}" \
  --url "${TARGET_BASE_URL}")"
TARGET_MAILBOX_ENDS_OUTPUT="$(capture_tufa ends add \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${TARGET_ALIAS}" \
  --role mailbox \
  --eid "${TARGET_PRE}")"
TARGET_AGENT_ENDS_OUTPUT="$(capture_tufa ends add \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${TARGET_ALIAS}" \
  --role agent \
  --eid "${TARGET_PRE}")"
assert_line_equals "$(last_non_empty_line "${TARGET_LOC_OUTPUT}")" "Location ${TARGET_BASE_URL} added for aid ${TARGET_PRE} with scheme http"
assert_line_equals "$(last_non_empty_line "${TARGET_MAILBOX_ENDS_OUTPUT}")" "mailbox ${TARGET_PRE}"
assert_line_equals "$(last_non_empty_line "${TARGET_AGENT_ENDS_OUTPUT}")" "agent ${TARGET_PRE}"

log "Start long-lived target agent host"
start_target_host

log "Verify target protocol-only host surface"
assert_status 200 "${TARGET_BASE_URL}/health"
assert_status 200 "${TARGET_BASE_URL}/oobi/${TARGET_PRE}/controller"
assert_status 200 "${TARGET_BASE_URL}/oobi/${TARGET_PRE}/mailbox/${TARGET_PRE}"
assert_status 200 "${TARGET_BASE_URL}/oobi/${TARGET_PRE}/agent/${TARGET_PRE}"
assert_status 404 "${TARGET_BASE_URL}/admin"
assert_status 404 "${TARGET_BASE_URL}/admin/queue"
assert_status 404 "${TARGET_BASE_URL}/rpc"
assert_status 404 "${TARGET_BASE_URL}/control"

# -----------------------------------------------------------------------------
# Cross-resolve mailbox OOBIs for indirect challenge delivery
# -----------------------------------------------------------------------------
log "Resolve target controller OOBI into the source store for challenge verification"
stop_source_host
TARGET_CONTROLLER_OOBI_OUTPUT="$(capture_tufa oobi generate \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${TARGET_ALIAS}" \
  --role controller)"
TARGET_CONTROLLER_OOBI="$(last_non_empty_line "${TARGET_CONTROLLER_OOBI_OUTPUT}")"
[[ "${TARGET_CONTROLLER_OOBI}" == "${TARGET_BASE_URL}/oobi/${TARGET_PRE}/controller" ]] || fail "unexpected target controller OOBI ${TARGET_CONTROLLER_OOBI}"
TARGET_MAILBOX_OOBI_OUTPUT="$(capture_tufa oobi generate \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${TARGET_ALIAS}" \
  --role mailbox)"
TARGET_MAILBOX_OOBI="$(last_non_empty_line "${TARGET_MAILBOX_OOBI_OUTPUT}")"
[[ "${TARGET_MAILBOX_OOBI}" == "${TARGET_BASE_URL}/oobi/${TARGET_PRE}/mailbox/${TARGET_PRE}" ]] || fail "unexpected target mailbox OOBI ${TARGET_MAILBOX_OOBI}"
SOURCE_TARGET_RESOLVE_OUTPUT="$(capture_tufa oobi resolve \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --url "${TARGET_CONTROLLER_OOBI}" \
  --oobi-alias "${TARGET_ALIAS}")"
SOURCE_TARGET_MAILBOX_RESOLVE_OUTPUT="$(capture_tufa oobi resolve \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --url "${TARGET_MAILBOX_OOBI}" \
  --oobi-alias "${TARGET_ALIAS}")"
assert_line_equals "$(last_non_empty_line "${SOURCE_TARGET_RESOLVE_OUTPUT}")" "${TARGET_CONTROLLER_OOBI}"
assert_line_equals "$(last_non_empty_line "${SOURCE_TARGET_MAILBOX_RESOLVE_OUTPUT}")" "${TARGET_MAILBOX_OOBI}"

# -----------------------------------------------------------------------------
# Challenge-response delivery modes
# -----------------------------------------------------------------------------
log "Exercise challenge generate/respond/verify over direct delivery"
DIRECT_CHALLENGE_WORDS="$(capture_challenge_words string)"
[[ -n "${DIRECT_CHALLENGE_WORDS}" ]] || fail "challenge generate returned no direct words"
DIRECT_RESPOND_OUTPUT="$(capture_tufa challenge respond \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${SOURCE_ALIAS}" \
  --recipient "${TARGET_ALIAS}" \
  --words "${DIRECT_CHALLENGE_WORDS}" \
  --transport direct)"
assert_line_contains "${DIRECT_RESPOND_OUTPUT}" "Sent EXN message"
stop_target_host
DIRECT_VERIFY_OUTPUT="$(capture_tufa challenge verify \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --signer "${SOURCE_PRE}" \
  --words "${DIRECT_CHALLENGE_WORDS}" \
  --timeout 5)"
assert_line_contains "$(last_non_empty_line "${DIRECT_VERIFY_OUTPUT}")" "${SOURCE_PRE}"

log "Exercise challenge generate/respond/verify over source-to-target mailbox delivery"
start_target_host
SOURCE_TO_TARGET_MAILBOX_WORDS="$(capture_challenge_words string)"
[[ -n "${SOURCE_TO_TARGET_MAILBOX_WORDS}" ]] || fail "challenge generate returned no source-to-target mailbox words"
SOURCE_TO_TARGET_MAILBOX_RESPOND_OUTPUT="$(capture_tufa challenge respond \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${SOURCE_ALIAS}" \
  --recipient "${TARGET_ALIAS}" \
  --words "${SOURCE_TO_TARGET_MAILBOX_WORDS}" \
  --transport indirect)"
assert_line_contains "${SOURCE_TO_TARGET_MAILBOX_RESPOND_OUTPUT}" "Sent EXN message"
stop_target_host
SOURCE_TO_TARGET_MAILBOX_VERIFY_OUTPUT="$(capture_tufa challenge verify \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --signer "${SOURCE_PRE}" \
  --words "${SOURCE_TO_TARGET_MAILBOX_WORDS}" \
  --timeout 5)"
assert_line_contains \
  "$(last_non_empty_line "${SOURCE_TO_TARGET_MAILBOX_VERIFY_OUTPUT}")" \
  "${SOURCE_PRE}"

log "Exercise challenge generate/respond/verify over target-to-source mailbox delivery"
start_source_host
TARGET_TO_SOURCE_MAILBOX_WORDS="$(capture_challenge_words string)"
[[ -n "${TARGET_TO_SOURCE_MAILBOX_WORDS}" ]] || fail "challenge generate returned no target-to-source mailbox words"
TARGET_TO_SOURCE_MAILBOX_RESPOND_OUTPUT="$(capture_tufa challenge respond \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "${TARGET_ALIAS}" \
  --recipient "${SOURCE_ALIAS}" \
  --words "${TARGET_TO_SOURCE_MAILBOX_WORDS}" \
  --transport indirect)"
assert_line_contains "${TARGET_TO_SOURCE_MAILBOX_RESPOND_OUTPUT}" "Sent EXN message"
stop_source_host
TARGET_TO_SOURCE_MAILBOX_VERIFY_OUTPUT="$(capture_tufa challenge verify \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --signer "${TARGET_PRE}" \
  --words "${TARGET_TO_SOURCE_MAILBOX_WORDS}" \
  --timeout 5)"
assert_line_contains \
  "$(last_non_empty_line "${TARGET_TO_SOURCE_MAILBOX_VERIFY_OUTPUT}")" \
  "${TARGET_PRE}"

log "Exercise generic exn send with alias-based recipient resolution"
start_target_host
EXN_CHALLENGE_WORDS="$(capture_challenge_words json)"
[[ -n "${EXN_CHALLENGE_WORDS}" ]] || fail "challenge generate returned no exn words"
EXN_SEND_OUTPUT="$(capture_tufa exn send \
  --name "${SOURCE_NAME}" \
  --head-dir "${SOURCE_HEAD}" \
  --passcode "${PASSCODE}" \
  --sender "${SOURCE_ALIAS}" \
  --recipient "${TARGET_ALIAS}" \
  --route /challenge/response \
  --data "{\"i\":\"${SOURCE_PRE}\",\"words\":${EXN_CHALLENGE_WORDS}}")"
assert_line_contains "${EXN_SEND_OUTPUT}" "Sent EXN message"
stop_target_host
EXN_VERIFY_OUTPUT="$(capture_tufa challenge verify \
  --name "${TARGET_NAME}" \
  --head-dir "${TARGET_HEAD}" \
  --passcode "${PASSCODE}" \
  --signer "${SOURCE_PRE}" \
  --words "${EXN_CHALLENGE_WORDS}" \
  --timeout 5)"
assert_line_contains "$(last_non_empty_line "${EXN_VERIFY_OUTPUT}")" "${SOURCE_PRE}"

# -----------------------------------------------------------------------------
# Config-seeded bootstrap coverage
# -----------------------------------------------------------------------------
log "Verify config-seeded init bootstrap convergence through source, target, and well-known OOBIs"
start_source_host
start_target_host
BOOT_INIT_URL="${BASE_URL}/oobi/${SOURCE_PRE}/controller"
BOOT_DELEGATE_URL="${TARGET_BASE_URL}/oobi/${TARGET_PRE}/controller"
BOOT_WELLKNOWN_URL="${BASE_URL}/.well-known/keri/oobi/${SOURCE_PRE}?name=Root"
assert_status 200 "${BOOT_INIT_URL}"
assert_status 200 "${BOOT_DELEGATE_URL}"
assert_status 200 "${BOOT_WELLKNOWN_URL}"

write_config "${CFG_INIT_DIR}" "${CFG_FILE_NAME}" "${BOOT_INIT_URL}" "${BOOT_DELEGATE_URL}" "${BOOT_WELLKNOWN_URL}"
run_tufa init \
  --name "${CFG_INIT_NAME}" \
  --head-dir "${CFG_INIT_HEAD}" \
  --passcode "${PASSCODE}" \
  --salt "${SALT}" \
  --config-dir "${CFG_INIT_DIR}" \
  --config-file "${CFG_FILE_NAME}" \
  >/dev/null
CFG_INIT_INCEPT_OUTPUT="$(capture_tufa incept \
  --name "${CFG_INIT_NAME}" \
  --head-dir "${CFG_INIT_HEAD}" \
  --passcode "${PASSCODE}" \
  --alias "cfg-init-local" \
  --transferable \
  --isith 1 \
  --icount 1 \
  --nsith 1 \
  --ncount 1 \
  --toad 0)"
CFG_INIT_PRE="$(extract_prefix "${CFG_INIT_INCEPT_OUTPUT}")"
assert_line_equals \
  "$(last_non_empty_line "$(capture_tufa aid \
    --name "${CFG_INIT_NAME}" \
    --head-dir "${CFG_INIT_HEAD}" \
    --passcode "${PASSCODE}" \
    --alias "cfg-init-local")")" \
  "${CFG_INIT_PRE}"

log "Verify config-seeded incept bootstrap convergence through an explicit external config path"
run_tufa init \
  --name "${CFG_INCEPT_NAME}" \
  --head-dir "${CFG_INCEPT_HEAD}" \
  --passcode "${PASSCODE}" \
  --salt "${SALT}" \
  >/dev/null
write_config "${CFG_INCEPT_DIR}" "${CFG_FILE_NAME}" "${BOOT_INIT_URL}" "${BOOT_DELEGATE_URL}" "${BOOT_WELLKNOWN_URL}"
CFG_INCEPT_OUTPUT="$(capture_tufa incept \
  --name "${CFG_INCEPT_NAME}" \
  --head-dir "${CFG_INCEPT_HEAD}" \
  --config-dir "${CFG_INCEPT_DIR}" \
  --config-file "${CFG_FILE_NAME}" \
  --passcode "${PASSCODE}" \
  --alias "${CFG_INCEPT_ALIAS}" \
  --transferable \
  --isith 1 \
  --icount 1 \
  --nsith 1 \
  --ncount 1 \
  --toad 0)"
CFG_INCEPT_PRE="$(extract_prefix "${CFG_INCEPT_OUTPUT}")"
assert_line_equals \
  "$(last_non_empty_line "$(capture_tufa aid \
    --name "${CFG_INCEPT_NAME}" \
    --head-dir "${CFG_INCEPT_HEAD}" \
    --passcode "${PASSCODE}" \
    --alias "${CFG_INCEPT_ALIAS}")")" \
  "${CFG_INCEPT_PRE}"

log "Gate E e2e script passed"
echo "Source AID: ${SOURCE_PRE}"
echo "Target AID: ${TARGET_PRE}"
echo "Config-incept AID: ${CFG_INCEPT_PRE}"
echo "Agent URL: ${BASE_URL}"
echo "Target Agent URL: ${TARGET_BASE_URL}"
