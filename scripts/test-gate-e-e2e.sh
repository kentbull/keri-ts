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
BOOT_INIT_ALIAS="bootstrap-init"
BOOT_DELEGATE_ALIAS="bootstrap-delegate"
BOOT_WELLKNOWN_ALIAS="bootstrap-wellknown"
TARGET_NAME="gate-e-target"
TARGET_ALIAS="bob"
CFG_INIT_NAME="gate-e-config-init"
CFG_INCEPT_NAME="gate-e-config-incept"
CFG_INCEPT_ALIAS="config-incept"
CFG_FILE_NAME="gate-e-bootstrap"

AGENT_LOG="${LOG_DIR}/source-agent.log"
AGENT_PID=""

TUFA=(deno run --allow-all --unstable-ffi packages/keri/mod.ts)

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${AGENT_PID}" ]]; then
    kill "${AGENT_PID}" >/dev/null 2>&1 || true
    wait "${AGENT_PID}" 2>/dev/null || true
  fi

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
  local url="${BASE_URL}/health"
  local body=""

  for _ in $(seq 1 100); do
    body="$(curl -fsS "${url}" 2>/dev/null || true)"
    if [[ "${body}" == "ok" ]]; then
      return
    fi
    sleep 0.1
  done

  echo "Agent log:" >&2
  cat "${AGENT_LOG}" >&2 || true
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

log "Using temp root ${TEMP_ROOT}"

log "Provision source store and identifiers"
run_tufa init --name "${SOURCE_NAME}" --head-dir "${SOURCE_HEAD}" --passcode "${PASSCODE}" --salt "${SALT}" >/dev/null

SOURCE_INCEPT_OUTPUT="$(capture_tufa incept --name "${SOURCE_NAME}" --head-dir "${SOURCE_HEAD}" --passcode "${PASSCODE}" --alias "${SOURCE_ALIAS}" --transferable --isith 1 --icount 1 --nsith 1 --ncount 1 --toad 0)"
SOURCE_PRE="$(extract_prefix "${SOURCE_INCEPT_OUTPUT}")"

BOOT_INIT_OUTPUT="$(capture_tufa incept --name "${SOURCE_NAME}" --head-dir "${SOURCE_HEAD}" --passcode "${PASSCODE}" --alias "${BOOT_INIT_ALIAS}" --transferable --isith 1 --icount 1 --nsith 1 --ncount 1 --toad 0)"
BOOT_INIT_PRE="$(extract_prefix "${BOOT_INIT_OUTPUT}")"

BOOT_DELEGATE_OUTPUT="$(capture_tufa incept --name "${SOURCE_NAME}" --head-dir "${SOURCE_HEAD}" --passcode "${PASSCODE}" --alias "${BOOT_DELEGATE_ALIAS}" --transferable --isith 1 --icount 1 --nsith 1 --ncount 1 --toad 0)"
BOOT_DELEGATE_PRE="$(extract_prefix "${BOOT_DELEGATE_OUTPUT}")"

BOOT_WELLKNOWN_OUTPUT="$(capture_tufa incept --name "${SOURCE_NAME}" --head-dir "${SOURCE_HEAD}" --passcode "${PASSCODE}" --alias "${BOOT_WELLKNOWN_ALIAS}" --transferable --isith 1 --icount 1 --nsith 1 --ncount 1 --toad 0)"
BOOT_WELLKNOWN_PRE="$(extract_prefix "${BOOT_WELLKNOWN_OUTPUT}")"

log "Drive runtime-backed loc add and ends add"
LOC_OUTPUT="$(capture_tufa loc add --name "${SOURCE_NAME}" --head-dir "${SOURCE_HEAD}" --passcode "${PASSCODE}" --alias "${SOURCE_ALIAS}" --url "${BASE_URL}")"
MAILBOX_ENDS_OUTPUT="$(capture_tufa ends add --name "${SOURCE_NAME}" --head-dir "${SOURCE_HEAD}" --passcode "${PASSCODE}" --alias "${SOURCE_ALIAS}" --role mailbox --eid "${SOURCE_PRE}")"
AGENT_ENDS_OUTPUT="$(capture_tufa ends add --name "${SOURCE_NAME}" --head-dir "${SOURCE_HEAD}" --passcode "${PASSCODE}" --alias "${SOURCE_ALIAS}" --role agent --eid "${SOURCE_PRE}")"
assert_line_equals "$(last_non_empty_line "${LOC_OUTPUT}")" "Location ${BASE_URL} added for aid ${SOURCE_PRE} with scheme http"
assert_line_equals "$(last_non_empty_line "${MAILBOX_ENDS_OUTPUT}")" "mailbox ${SOURCE_PRE}"
assert_line_equals "$(last_non_empty_line "${AGENT_ENDS_OUTPUT}")" "agent ${SOURCE_PRE}"

log "Start long-lived tufa agent host"
run_tufa agent --name "${SOURCE_NAME}" --head-dir "${SOURCE_HEAD}" --passcode "${PASSCODE}" --port "${PORT}" >"${AGENT_LOG}" 2>&1 &
AGENT_PID="$!"
wait_for_health

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
CONTROLLER_OOBI_OUTPUT="$(capture_tufa oobi generate --name "${SOURCE_NAME}" --head-dir "${SOURCE_HEAD}" --passcode "${PASSCODE}" --alias "${SOURCE_ALIAS}" --role controller)"
MAILBOX_OOBI_OUTPUT="$(capture_tufa oobi generate --name "${SOURCE_NAME}" --head-dir "${SOURCE_HEAD}" --passcode "${PASSCODE}" --alias "${SOURCE_ALIAS}" --role mailbox)"
AGENT_OOBI_OUTPUT="$(capture_tufa oobi generate --name "${SOURCE_NAME}" --head-dir "${SOURCE_HEAD}" --passcode "${PASSCODE}" --alias "${SOURCE_ALIAS}" --role agent)"
CONTROLLER_OOBI="$(last_non_empty_line "${CONTROLLER_OOBI_OUTPUT}")"
MAILBOX_OOBI="$(last_non_empty_line "${MAILBOX_OOBI_OUTPUT}")"
AGENT_OOBI="$(last_non_empty_line "${AGENT_OOBI_OUTPUT}")"

[[ "${CONTROLLER_OOBI}" == "${BASE_URL}/oobi/${SOURCE_PRE}/controller" ]] || fail "unexpected controller OOBI ${CONTROLLER_OOBI}"
[[ "${MAILBOX_OOBI}" == "${BASE_URL}/oobi/${SOURCE_PRE}/mailbox/${SOURCE_PRE}" ]] || fail "unexpected mailbox OOBI ${MAILBOX_OOBI}"
[[ "${AGENT_OOBI}" == "${BASE_URL}/oobi/${SOURCE_PRE}/agent/${SOURCE_PRE}" ]] || fail "unexpected agent OOBI ${AGENT_OOBI}"

log "Resolve generated OOBIs into a second controller store"
run_tufa init --name "${TARGET_NAME}" --head-dir "${TARGET_HEAD}" --passcode "${PASSCODE}" --salt "${SALT}" >/dev/null
CONTROLLER_RESOLVE_OUTPUT="$(capture_tufa oobi resolve --name "${TARGET_NAME}" --head-dir "${TARGET_HEAD}" --passcode "${PASSCODE}" --url "${CONTROLLER_OOBI}" --oobi-alias "${SOURCE_ALIAS}-controller")"
MAILBOX_RESOLVE_OUTPUT="$(capture_tufa oobi resolve --name "${TARGET_NAME}" --head-dir "${TARGET_HEAD}" --passcode "${PASSCODE}" --url "${MAILBOX_OOBI}" --oobi-alias "${SOURCE_ALIAS}-mailbox")"
AGENT_RESOLVE_OUTPUT="$(capture_tufa oobi resolve --name "${TARGET_NAME}" --head-dir "${TARGET_HEAD}" --passcode "${PASSCODE}" --url "${AGENT_OOBI}" --oobi-alias "${SOURCE_ALIAS}-agent")"
assert_line_equals "$(last_non_empty_line "${CONTROLLER_RESOLVE_OUTPUT}")" "${CONTROLLER_OOBI}"
assert_line_equals "$(last_non_empty_line "${MAILBOX_RESOLVE_OUTPUT}")" "${MAILBOX_OOBI}"
assert_line_equals "$(last_non_empty_line "${AGENT_RESOLVE_OUTPUT}")" "${AGENT_OOBI}"
TARGET_INCEPT_OUTPUT="$(capture_tufa incept --name "${TARGET_NAME}" --head-dir "${TARGET_HEAD}" --passcode "${PASSCODE}" --alias "${TARGET_ALIAS}" --transferable --isith 1 --icount 1 --nsith 1 --ncount 1 --toad 0)"
TARGET_PRE="$(extract_prefix "${TARGET_INCEPT_OUTPUT}")"
assert_line_equals "$(last_non_empty_line "$(capture_tufa aid --name "${TARGET_NAME}" --head-dir "${TARGET_HEAD}" --passcode "${PASSCODE}" --alias "${TARGET_ALIAS}")")" "${TARGET_PRE}"

log "Verify config-seeded init bootstrap convergence through oobis and woobi"
BOOT_INIT_URL="${BASE_URL}/oobi/${BOOT_INIT_PRE}/controller"
BOOT_DELEGATE_URL="${BASE_URL}/oobi/${BOOT_DELEGATE_PRE}/controller"
BOOT_WELLKNOWN_URL="${BASE_URL}/.well-known/keri/oobi/${BOOT_WELLKNOWN_PRE}?name=Root"
assert_status 200 "${BOOT_INIT_URL}"
assert_status 200 "${BOOT_DELEGATE_URL}"
assert_status 200 "${BOOT_WELLKNOWN_URL}"

write_config "${CFG_INIT_DIR}" "${CFG_FILE_NAME}" "${BOOT_INIT_URL}" "${BOOT_DELEGATE_URL}" "${BOOT_WELLKNOWN_URL}"
run_tufa init --name "${CFG_INIT_NAME}" --head-dir "${CFG_INIT_HEAD}" --passcode "${PASSCODE}" --salt "${SALT}" --config-dir "${CFG_INIT_DIR}" --config-file "${CFG_FILE_NAME}" >/dev/null
CFG_INIT_INCEPT_OUTPUT="$(capture_tufa incept --name "${CFG_INIT_NAME}" --head-dir "${CFG_INIT_HEAD}" --passcode "${PASSCODE}" --alias "cfg-init-local" --transferable --isith 1 --icount 1 --nsith 1 --ncount 1 --toad 0)"
CFG_INIT_PRE="$(extract_prefix "${CFG_INIT_INCEPT_OUTPUT}")"
assert_line_equals "$(last_non_empty_line "$(capture_tufa aid --name "${CFG_INIT_NAME}" --head-dir "${CFG_INIT_HEAD}" --passcode "${PASSCODE}" --alias "cfg-init-local")")" "${CFG_INIT_PRE}"

log "Verify config-seeded incept bootstrap convergence through an explicit external config path"
run_tufa init --name "${CFG_INCEPT_NAME}" --head-dir "${CFG_INCEPT_HEAD}" --passcode "${PASSCODE}" --salt "${SALT}" >/dev/null
write_config "${CFG_INCEPT_DIR}" "${CFG_FILE_NAME}" "${BOOT_INIT_URL}" "${BOOT_DELEGATE_URL}" "${BOOT_WELLKNOWN_URL}"
CFG_INCEPT_OUTPUT="$(capture_tufa incept --name "${CFG_INCEPT_NAME}" --head-dir "${CFG_INCEPT_HEAD}" --config-dir "${CFG_INCEPT_DIR}" --config-file "${CFG_FILE_NAME}" --passcode "${PASSCODE}" --alias "${CFG_INCEPT_ALIAS}" --transferable --isith 1 --icount 1 --nsith 1 --ncount 1 --toad 0)"
CFG_INCEPT_PRE="$(extract_prefix "${CFG_INCEPT_OUTPUT}")"
assert_line_equals "$(last_non_empty_line "$(capture_tufa aid --name "${CFG_INCEPT_NAME}" --head-dir "${CFG_INCEPT_HEAD}" --passcode "${PASSCODE}" --alias "${CFG_INCEPT_ALIAS}")")" "${CFG_INCEPT_PRE}"

log "Gate E e2e script passed"
echo "Source AID: ${SOURCE_PRE}"
echo "Target AID: ${TARGET_PRE}"
echo "Config-incept AID: ${CFG_INCEPT_PRE}"
echo "Agent URL: ${BASE_URL}"
