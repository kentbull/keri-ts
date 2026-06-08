#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="$(cd "${ROOT_DIR}/../../.." && pwd)"
KERIPY_DIR="${KERIPY_DIR:-${WORKSPACE_ROOT}/core/python/keripy}"
KLI_CMD="${KLI_CMD:-${KERIPY_DIR}/venv/bin/kli}"

RUN_ID="${RUN_ID:-vlei-tufa-sally-$(date +%Y%m%d%H%M%S)-$RANDOM}"
RUN_DIR="${RUN_DIR:-/Users/kbull/tmp/${RUN_ID}}"
LOG_DIR="${RUN_DIR}/logs"
TUFA_HEAD="${RUN_DIR}/tufa"
KLI_CONFIG_DIR="${RUN_DIR}/keripy-config"
KERI_BASE="${KERI_BASE:-${RUN_ID}}"
KEEP_RUN_DIR="${KEEP_RUN_DIR:-true}"
SALLY_VLEI_IMAGE="${SALLY_VLEI_IMAGE:-gleif/vlei:1.0.3}"
SALLY_IMAGE="${SALLY_IMAGE:-tufa/sally-cli:local}"
SALLY_BASE_IMAGE="${SALLY_BASE_IMAGE:-w3c-crosswalk/isomer-python:local}"
SALLY_LOGLEVEL="${SALLY_LOGLEVEL:-DEBUG}"
SALLY_COUNTER_PROFILE="${SALLY_COUNTER_PROFILE:-legacy}"

TUFACMD=(deno run --allow-all --unstable-ffi "${ROOT_DIR}/packages/tufa/mod.ts")

QVI_SCHEMA="EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao"
LE_SCHEMA="ENPXp1vQzRF6JwIuS-mp2U8Uf1MoADoP_GqQ62VsDZWY"
OOR_AUTH_SCHEMA="EKA57bKBKxr_kN7iN5i7lMUxpMG-s19dRcmov1iDxz-E"
OOR_SCHEMA="EBNaNu-M9P5cgrnfl2Fvymy4E_jvxxyjb70PRtiANlJy"
ECR_AUTH_SCHEMA="EH6ekLjSr8V32WyFbGe1zXjTzFs9PkTYmupJ9H65O14g"
ECR_SCHEMA="EEy9PkikFcANV1l7EHukCeXqrzT1hNZjGlUk7wuMO5jw"

LE_LEI="254900OPPU84GM83MG36"
PERSON_NAME="Mordred Delacqs"
PERSON_OOR="Advisor"

WAN_PRE="BBilc4-L3tFUnfM_wJr4S4OJanAv_VmF_dJNN6vkf2Ha"
WIL_PRE="BLskRTInXnMxWaGqcpSyMgo0nYbalW99cGZESrz3zapM"
WES_PRE="BIKKuvBwpmDVA4Ds-EpL5bt9OqPzWPja2LigFYZN2YfX"
WAN_OOBI="http://127.0.0.1:5642/oobi/${WAN_PRE}/controller"
WIL_OOBI="http://127.0.0.1:5643/oobi/${WIL_PRE}/controller"
WES_OOBI="http://127.0.0.1:5644/oobi/${WES_PRE}/controller"

PIDS=()
PID_NAMES=()
DOCKER_CONTAINERS=()
DOCKER_NETWORK=""

log() {
  printf '[vlei-tufa-sally] %s\n' "$*" >&2
}

fail() {
  printf '[vlei-tufa-sally] ERROR: %s\n' "$*" >&2
  exit 1
}

capture_docker_logs() {
  mkdir -p "${LOG_DIR}"
  local container
  for container in "${DOCKER_CONTAINERS[@]:-}"; do
    [[ -n "${container}" ]] || continue
    if docker inspect "${container}" >/dev/null 2>&1; then
      docker logs "${container}" >"${LOG_DIR}/${container}.log" 2>&1 || true
    fi
  done
  if [[ -n "${SALLY_HOOK_CONTAINER:-}" ]] && docker inspect "${SALLY_HOOK_CONTAINER}" >/dev/null 2>&1; then
    docker logs "${SALLY_HOOK_CONTAINER}" >"${LOG_DIR}/sally-hook.log" 2>&1 || true
  fi
  if [[ -n "${SALLY_CONTAINER:-}" ]] && docker inspect "${SALLY_CONTAINER}" >/dev/null 2>&1; then
    docker logs "${SALLY_CONTAINER}" >"${LOG_DIR}/sally.log" 2>&1 || true
  fi
}

cleanup() {
  local i
  for ((i=${#PIDS[@]}-1; i>=0; i--)); do
    if kill -0 "${PIDS[$i]}" >/dev/null 2>&1; then
      log "stopping ${PID_NAMES[$i]} (${PIDS[$i]})"
      kill "${PIDS[$i]}" >/dev/null 2>&1 || true
      wait "${PIDS[$i]}" >/dev/null 2>&1 || true
    fi
  done

  capture_docker_logs
  for container in "${DOCKER_CONTAINERS[@]:-}"; do
    docker rm -f "${container}" >/dev/null 2>&1 || true
  done
  if [[ -n "${DOCKER_NETWORK}" ]]; then
    docker network rm "${DOCKER_NETWORK}" >/dev/null 2>&1 || true
  fi

  if [[ "${KEEP_RUN_DIR}" != "true" ]]; then
    rm -rf "${RUN_DIR}"
  fi
}
trap cleanup EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

run() {
  log "+ $*"
  "$@"
}

capture() {
  local __var="$1"
  shift
  local __capture_out
  log "+ $*"
  if ! __capture_out="$("$@" 2>&1)"; then
    printf '%s\n' "$__capture_out" >&2
    fail "command failed: $*"
  fi
  printf -v "${__var}" '%s' "$__capture_out"
}

start_bg() {
  local name="$1"
  local log_file="$2"
  shift 2
  log "+ $* > ${log_file} &"
  "$@" >"${log_file}" 2>&1 &
  PIDS+=("$!")
  PID_NAMES+=("${name}")
}

start_cmd_bg() {
  local __pid_var="$1"
  local name="$2"
  local log_file="$3"
  shift 3
  log "+ $* > ${log_file} &"
  "$@" >"${log_file}" 2>&1 &
  printf -v "${__pid_var}" '%s' "$!"
  PIDS+=("$!")
  PID_NAMES+=("${name}")
}

wait_cmd_bg() {
  local pid="$1"
  local log_file="$2"
  if ! wait "${pid}"; then
    [[ -f "${log_file}" ]] && sed -n '1,220p' "${log_file}" >&2
    fail "background command ${pid} failed"
  fi
  [[ -f "${log_file}" ]] && cat "${log_file}"
}

wait_for_log() {
  local file="$1"
  local pattern="$2"
  local timeout="${3:-60}"
  local pid="${4:-}"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if [[ -f "${file}" ]] && grep -qE "${pattern}" "${file}"; then
      return 0
    fi
    if [[ -n "${pid}" ]] && ! kill -0 "${pid}" >/dev/null 2>&1; then
      [[ -f "${file}" ]] && sed -n '1,160p' "${file}" >&2
      fail "background process ${pid} exited before ${pattern} appeared in ${file}"
    fi
    sleep 0.25
  done
  [[ -f "${file}" ]] && sed -n '1,160p' "${file}" >&2
  fail "timed out waiting for ${pattern} in ${file}"
}

wait_http() {
  local url="$1"
  local timeout="${2:-60}"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  fail "timed out waiting for ${url}"
}

docker_image_exists() {
  docker image inspect "$1" >/dev/null 2>&1
}

ensure_sally_image() {
  if docker_image_exists "${SALLY_IMAGE}"; then
    return 0
  fi
  if ! docker_image_exists "${SALLY_BASE_IMAGE}"; then
    fail "missing Sally image ${SALLY_IMAGE} and fallback base ${SALLY_BASE_IMAGE}; set SALLY_IMAGE to a local Sally image or build ${SALLY_BASE_IMAGE}"
  fi

  local dockerfile="${RUN_DIR}/sally-local.Dockerfile"
  cat >"${dockerfile}" <<DOCKER
FROM ${SALLY_BASE_IMAGE}
WORKDIR /sally
COPY setup.py README.md LICENSE ./
COPY src/ src/
RUN pip install -e . --no-deps
DOCKER
  run docker build -t "${SALLY_IMAGE}" -f "${dockerfile}" "${WORKSPACE_ROOT}/verifier/apps/sally"
}

random_port() {
  local port
  for _ in {1..50}; do
    port=$((49152 + RANDOM % 16384))
    if ! lsof -ti "tcp:${port}" >/dev/null 2>&1; then
      printf '%s\n' "${port}"
      return 0
    fi
  done
  fail "could not allocate an unused local port"
}

tufa() {
  "${TUFACMD[@]}" "$@"
}

tufa_store() {
  local name="$1"
  shift
  tufa -n "${name}" --head-dir "${TUFA_HEAD}" "$@"
}

tufa_store_alias() {
  local name="$1"
  local alias="$2"
  shift 2
  tufa -n "${name}" --head-dir "${TUFA_HEAD}" -a "${alias}" "$@"
}

aid() {
  local name="$1"
  local alias="$2"
  local out
  capture out tufa aid -n "${name}" --head-dir "${TUFA_HEAD}" -a "${alias}"
  printf '%s\n' "${out}" | awk 'NF { line=$0 } END { print line }'
}

json_field() {
  local text="$1"
  local expr="$2"
  printf '%s\n' "${text}" | awk '/^\{/ { line=$0 } END { print line }' | jq -r "${expr}"
}

assert_delegated_from() {
  local store="$1"
  local alias="$2"
  local delegated="$3"
  local delegator="$4"
  local out
  capture out tufa query -n "${store}" --head-dir "${TUFA_HEAD}" -a "${alias}" --prefix "${delegated}"
  if ! grep -q '^Delegated Identifier$' <<<"${out}"; then
    printf '%s\n' "${out}" >&2
    fail "${delegated} is not reported as a delegated identifier in ${store}"
  fi
  if ! grep -qF "    Delegator:  ${delegator}" <<<"${out}"; then
    printf '%s\n' "${out}" >&2
    fail "${delegated} is not delegated from expected delegator ${delegator} in ${store}"
  fi
  log "verified ${delegated} is delegated from ${delegator} in ${store}"
}

schema_path() {
  printf '%s/credentials/schema-tools/schema/vLEI/%s\n' "${WORKSPACE_ROOT}" "$1"
}

rules_path() {
  printf '%s\n' "/Users/kbull/tmp/qvi-software-inspect/qvi-workflow/kli_docker/acdc-info/rules/$1"
}

resolve_oobi() {
  local store="$1"
  local url="$2"
  local alias="$3"
  run tufa oobi resolve -n "${store}" --head-dir "${TUFA_HEAD}" -u "${url}" -A "${alias}"
}

resolve_witnesses() {
  local store="$1"
  shift
  local item pre oobi alias
  for item in "$@"; do
    IFS='|' read -r alias pre oobi <<<"${item}"
    resolve_oobi "${store}" "${oobi}" "${alias}"
  done
}

incept_tufa_aid() {
  local store="$1"
  local alias="$2"
  shift 2
  local witnesses=("$@")
  local args=(incept -n "${store}" --head-dir "${TUFA_HEAD}" -a "${alias}" -tf -t 2 --receipt-endpoint)
  local wit
  for wit in "${witnesses[@]}"; do
    args+=(-w "${wit}")
  done
  run tufa "${args[@]}"
}

add_mailbox() {
  local store="$1"
  local alias="$2"
  local mailbox_oobi="$3"
  local mailbox_alias="$4"
  resolve_oobi "${store}" "${mailbox_oobi}" "${mailbox_alias}"
  run tufa mailbox add -n "${store}" --head-dir "${TUFA_HEAD}" -a "${alias}" -w "${mailbox_alias}"
}

mailbox_oobi() {
  local store="$1"
  local alias="$2"
  local out
  capture out tufa oobi generate -n "${store}" --head-dir "${TUFA_HEAD}" -a "${alias}" -r mailbox
  printf '%s\n' "${out}" | awk 'NF { line=$0 } END { print line }'
}

witness_oobis() {
  local store="$1"
  local alias="$2"
  local out
  capture out tufa oobi generate -n "${store}" --head-dir "${TUFA_HEAD}" -a "${alias}" -r witness
  printf '%s\n' "${out}" | awk '/^https?:\/\//'
}

resolve_oobi_lines() {
  local store="$1"
  local alias="$2"
  local urls="$3"
  local url
  [[ -n "${urls}" ]] || fail "no OOBIs available for ${alias}"
  while IFS= read -r url; do
    [[ -n "${url}" ]] || continue
    resolve_oobi "${store}" "${url}" "${alias}"
  done <<<"${urls}"
}

saidify_file() {
  run tufa saidify -f "$1"
}

import_schemas() {
  local store="$1"
  run tufa vc schema import -n "${store}" --head-dir "${TUFA_HEAD}" \
    --schema "$(schema_path qualified-vLEI-issuer-vLEI-credential.schema.json)" \
    --schema "$(schema_path legal-entity-vLEI-credential.schema.json)" \
    --schema "$(schema_path oor-authorization-vlei-credential.schema.json)" \
    --schema "$(schema_path legal-entity-official-organizational-role-vLEI-credential.schema.json)" \
    --schema "$(schema_path ecr-authorization-vlei-credential.schema.json)" \
    --schema "$(schema_path legal-entity-engagement-context-role-vLEI-credential.schema.json)"
}

multisig_round() {
  local role="$1"
  local store1="$2"
  local member1="$3"
  local store2="$4"
  local member2="$5"
  local group="$6"
  shift 6
  local witnesses=("$@")
  local cfg="${RUN_DIR}/${role}-multisig-incept.json"
  local pre1 pre2
  pre1="$(aid "${store1}" "${member1}")"
  pre2="$(aid "${store2}" "${member2}")"
  jq -n \
    --arg a "${pre1}" \
    --arg b "${pre2}" \
    --argjson wits "$(printf '%s\n' "${witnesses[@]}" | jq -R . | jq -s .)" \
    '{aids: [$a, $b], isith: "2", nsith: "2", toad: 2, wits: $wits}' \
    >"${cfg}"

  run tufa multisig incept -n "${store1}" --head-dir "${TUFA_HEAD}" -a "${member1}" -g "${group}" -f "${cfg}" --wait 1
  run tufa multisig join -n "${store2}" --head-dir "${TUFA_HEAD}" -g "${group}" -Y --max-turns 80 --budget-ms 2000 --receipt-endpoint
  run tufa multisig join -n "${store1}" --head-dir "${TUFA_HEAD}" -g "${group}" -Y --max-turns 80 --budget-ms 2000 --receipt-endpoint
}

delegated_qvi_multisig_round() {
  local cfg="${RUN_DIR}/qvi-multisig-incept.json"
  local pre1 pre2 qvi_pre qvi1_log qvi1_pid qvi2_log qvi2_pid anchor_file geda_wit_oobis
  pre1="$(aid qvi1 qvi-m1)"
  pre2="$(aid qvi2 qvi-m2)"
  jq -n \
    --arg a "${pre1}" \
    --arg b "${pre2}" \
    --arg delpre "${GEDA_PRE}" \
    --argjson wits "$(printf '%s\n' "${QVI_WITS[@]}" | jq -R . | jq -s .)" \
    '{aids: [$a, $b], isith: "2", nsith: "2", toad: 2, wits: $wits, delpre: $delpre}' \
    >"${cfg}"

  geda_wit_oobis="$(witness_oobis geda1 geda)"
  resolve_oobi_lines qvi1 geda "${geda_wit_oobis}"
  resolve_oobi_lines qvi2 geda "${geda_wit_oobis}"

  qvi1_log="${LOG_DIR}/qvi-delegated-incept-qvi1.log"
  start_cmd_bg qvi1_pid qvi-delegated-incept-qvi1 "${qvi1_log}" \
    tufa multisig incept -n qvi1 --head-dir "${TUFA_HEAD}" -a qvi-m1 -g qvi -f "${cfg}" --proxy qvi-m1 --wait 120

  qvi2_log="${LOG_DIR}/qvi-delegated-join-qvi2.log"
  start_cmd_bg qvi2_pid qvi-delegated-join-qvi2 "${qvi2_log}" \
    tufa multisig join -n qvi2 --head-dir "${TUFA_HEAD}" -g qvi -Y --max-turns 120 --budget-ms 2000 --receipt-endpoint --proxy qvi-m2

  run tufa delegate confirm -n geda1 --head-dir "${TUFA_HEAD}" -a geda --interact --auto
  run tufa multisig join -n geda2 --head-dir "${TUFA_HEAD}" -g geda -Y --max-turns 120 --budget-ms 2000 --receipt-endpoint
  run tufa multisig join -n geda1 --head-dir "${TUFA_HEAD}" -g geda -Y --max-turns 120 --budget-ms 2000 --receipt-endpoint
  run tufa delegate confirm -n geda1 --head-dir "${TUFA_HEAD}" -a geda --interact --auto
  run tufa delegate confirm -n geda2 --head-dir "${TUFA_HEAD}" -a geda --interact --auto
  wait_cmd_bg "${qvi2_pid}" "${qvi2_log}"
  wait_cmd_bg "${qvi1_pid}" "${qvi1_log}"
  qvi_pre="$(sed -n '/^{/p' "${qvi1_log}" | tail -1 | jq -r '.group // empty')"
  [[ -n "${qvi_pre}" && "${qvi_pre}" != "null" ]] || fail "unable to parse delegated QVI prefix"
  anchor_file="${RUN_DIR}/qvi-delegation-anchor.json"
  jq -n --arg i "${qvi_pre}" '{i: $i, s: "0", d: $i}' >"${anchor_file}"
  run tufa query -n qvi1 --head-dir "${TUFA_HEAD}" -a qvi-m1 --prefix "${GEDA_PRE}" --anchor "${anchor_file}"
  run tufa query -n qvi2 --head-dir "${TUFA_HEAD}" -a qvi-m2 --prefix "${GEDA_PRE}" --anchor "${anchor_file}"
  assert_delegated_from qvi1 qvi-m1 "${qvi_pre}" "${GEDA_PRE}"
  assert_delegated_from qvi2 qvi-m2 "${qvi_pre}" "${GEDA_PRE}"
}

registry_round() {
  local store1="$1"
  local store2="$2"
  local group="$3"
  local registry="$4"
  run tufa vc registry incept -n "${store1}" --head-dir "${TUFA_HEAD}" -a "${group}" --registry-name "${registry}" --usage "${registry}"
  run tufa multisig join -n "${store2}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}" -Y --max-turns 80 --budget-ms 2000 --receipt-endpoint
  run tufa multisig join -n "${store1}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}" -Y --max-turns 80 --budget-ms 2000 --receipt-endpoint
  run tufa vc registry status -n "${store1}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}"
  run tufa vc registry status -n "${store2}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}"
}

multisig_rpy_round() {
  local store1="$1"
  local store2="$2"
  local group="$3"
  local eid="$4"
  run tufa multisig rpy -n "${store1}" --head-dir "${TUFA_HEAD}" -a "${group}" --eid "${eid}" --role mailbox --wait 0
  run tufa multisig join -n "${store2}" --head-dir "${TUFA_HEAD}" -Y --max-turns 80 --budget-ms 2000
  run tufa multisig join -n "${store1}" --head-dir "${TUFA_HEAD}" -Y --max-turns 80 --budget-ms 2000
}

credential_round() {
  local __said_var="$1"
  local store1="$2"
  local store2="$3"
  local group="$4"
  local registry="$5"
  local schema="$6"
  local recipient="$7"
  local data_file="$8"
  local edges_file="${9:-}"
  local rules_file="${10:-}"
  local output args
  args=(vc create -n "${store1}" --head-dir "${TUFA_HEAD}" -a "${group}" --registry-name "${registry}" --schema "${schema}" --recipient "${recipient}" --data "@${data_file}")
  [[ -n "${edges_file}" ]] && args+=(--edges "@${edges_file}")
  [[ -n "${rules_file}" ]] && args+=(--rules "@${rules_file}")
  capture output tufa "${args[@]}"
  printf '%s\n' "${output}"
  run tufa multisig join -n "${store2}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}" -Y --max-turns 80 --budget-ms 2000 --receipt-endpoint
  run tufa multisig join -n "${store1}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}" -Y --max-turns 80 --budget-ms 2000 --receipt-endpoint
  printf -v "${__said_var}" '%s' "$(json_field "${output}" '.said')"
}

poll_saved() {
  local store="$1"
  local alias="$2"
  local said="$3"
  local out
  local i
  for i in $(seq 1 30); do
    capture out tufa ipex poll -n "${store}" --head-dir "${TUFA_HEAD}" -a "${alias}" --max-turns 8 --budget-ms 2000
    printf '%s\n' "${out}"
    if printf '%s\n' "${out}" | awk '/^\{/ { line=$0 } END { print line }' | jq -e --arg said "${said}" '.saved | index($said)' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  fail "${store}:${alias} did not save credential ${said}"
}

grant_group_credential() {
  local issuer1="$1"
  local issuer2="$2"
  local group="$3"
  local recipient="$4"
  local said="$5"
  log "starting group IPEX grant ${said} from ${group} to ${recipient}"
  run tufa ipex grant -n "${issuer1}" --head-dir "${TUFA_HEAD}" -a "${group}" -r "${recipient}" --said "${said}" --delivery indirect --wait 0
  run tufa ipex join -n "${issuer2}" --head-dir "${TUFA_HEAD}" --auto --max-turns 100 --budget-ms 2000
  run tufa ipex join -n "${issuer1}" --head-dir "${TUFA_HEAD}" --auto --max-turns 100 --budget-ms 2000
}

present_group_to_sally() {
  local holder1="$1"
  local holder2="$2"
  local group="$3"
  local said="$4"
  local expected="$5"
  log "presenting ${expected} ${said} from ${group} to Sally"
  run tufa ipex grant -n "${holder1}" --head-dir "${TUFA_HEAD}" -a "${group}" -r "${SALLY_PRE}" --said "${said}" --delivery direct --wait 0 --counter-profile "${SALLY_COUNTER_PROFILE}"
  run tufa ipex join -n "${holder2}" --head-dir "${TUFA_HEAD}" --auto --max-turns 100 --budget-ms 2000 --counter-profile "${SALLY_COUNTER_PROFILE}"
  run tufa ipex join -n "${holder1}" --head-dir "${TUFA_HEAD}" --auto --max-turns 100 --budget-ms 2000 --delivery direct --counter-profile "${SALLY_COUNTER_PROFILE}"
  wait_hook "${expected}"
}

present_single_to_sally() {
  local store="$1"
  local alias="$2"
  local said="$3"
  local expected="$4"
  run tufa ipex grant -n "${store}" --head-dir "${TUFA_HEAD}" -a "${alias}" -r "${SALLY_PRE}" --said "${said}" --delivery direct --counter-profile "${SALLY_COUNTER_PROFILE}"
  wait_hook "${expected}"
}

wait_hook() {
  local expected="$1"
  local holder i body
  case "${expected}" in
    QVI) holder="${QVI_PRE}" ;;
    LE) holder="${LE_PRE}" ;;
    OOR) holder="${OOR_PRE}" ;;
    *) fail "unknown Sally hook type ${expected}" ;;
  esac
  for i in $(seq 1 90); do
    if body="$(curl -fsS "http://127.0.0.1:${SALLY_HOOK_PORT}/?holder=${holder}" 2>/dev/null)"; then
      printf '%s\n' "${body}" | jq -e --arg typ "${expected}" '.type == $typ' >/dev/null 2>&1 && return 0
    fi
    sleep 1
  done
  if [[ -n "${body:-}" ]]; then
    log "last Sally hook response for ${expected}: ${body}"
  fi
  capture_docker_logs
  docker logs "${SALLY_HOOK_CONTAINER}" >&2 || true
  docker logs "${SALLY_CONTAINER}" >&2 || true
  fail "Sally hook did not record ${expected}"
}

start_sally_stack() {
  local conf_dir="${RUN_DIR}/sally-conf"
  local sally_var="${RUN_DIR}/sally-var"
  mkdir -p "${conf_dir}" "${sally_var}"
  SALLY_VLEI_PORT="$(random_port)"
  SALLY_HOOK_PORT="$(random_port)"
  SALLY_PORT="$(random_port)"
  local suffix="${RUN_ID##*-}"
  DOCKER_NETWORK="tufa-sally-${suffix}"
  SALLY_VLEI_CONTAINER="tufa-vlei-${suffix}"
  SALLY_HOOK_CONTAINER="tufa-sally-hook-${suffix}"
  SALLY_CONTAINER="tufa-sally-${suffix}"
  DOCKER_CONTAINERS=("${SALLY_CONTAINER}" "${SALLY_HOOK_CONTAINER}" "${SALLY_VLEI_CONTAINER}")

  cat >"${conf_dir}/direct-sally.json" <<JSON
{
  "dt": "2022-10-31T12:59:57.823350+00:00",
  "direct-sally": {
    "dt": "2022-01-20T12:57:59.823350+00:00",
    "curls": ["http://sally:9723/"]
  },
  "iurls": [],
  "durls": [
    "http://${SALLY_VLEI_CONTAINER}:7723/oobi/${OOR_SCHEMA}",
    "http://${SALLY_VLEI_CONTAINER}:7723/oobi/${ECR_AUTH_SCHEMA}",
    "http://${SALLY_VLEI_CONTAINER}:7723/oobi/${OOR_AUTH_SCHEMA}",
    "http://${SALLY_VLEI_CONTAINER}:7723/oobi/${LE_SCHEMA}",
    "http://${SALLY_VLEI_CONTAINER}:7723/oobi/${QVI_SCHEMA}",
    "http://${SALLY_VLEI_CONTAINER}:7723/oobi/${ECR_SCHEMA}"
  ]
}
JSON
  cat >"${conf_dir}/schema-oobis.txt" <<SCHEMAOOBIS
http://${SALLY_VLEI_CONTAINER}:7723/oobi/${OOR_SCHEMA}
http://${SALLY_VLEI_CONTAINER}:7723/oobi/${ECR_AUTH_SCHEMA}
http://${SALLY_VLEI_CONTAINER}:7723/oobi/${OOR_AUTH_SCHEMA}
http://${SALLY_VLEI_CONTAINER}:7723/oobi/${LE_SCHEMA}
http://${SALLY_VLEI_CONTAINER}:7723/oobi/${QVI_SCHEMA}
http://${SALLY_VLEI_CONTAINER}:7723/oobi/${ECR_SCHEMA}
SCHEMAOOBIS
  cat >"${conf_dir}/sally-incept-no-wits.json" <<'JSON'
{
  "transferable": true,
  "wits": [],
  "toad": 0,
  "icount": 1,
  "ncount": 1,
  "isith": "1",
  "nsith": "1"
}
JSON
  cat >"${conf_dir}/entry-point.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
kli init --name "${SALLY}" --salt "${SALLY_SALT}" --passcode "${SALLY_PASSCODE}" --config-dir /sally/conf --config-file direct-sally.json
kli incept --name "${SALLY}" --alias "${SALLY}" --passcode "${SALLY_PASSCODE}" --file /sally/conf/sally-incept-no-wits.json
while IFS= read -r oobi; do
  [[ -n "${oobi}" ]] || continue
  kli oobi resolve --name "${SALLY}" --passcode "${SALLY_PASSCODE}" --oobi "${oobi}"
done </sally/conf/schema-oobis.txt
sally server start --name "${SALLY}" --alias "${SALLY}" --passcode "${SALLY_PASSCODE}" --config-dir /sally/conf --config-file direct-sally.json --web-hook "${WEBHOOK_HOST}" --auth "${GEDA_PRE}" --loglevel "${SALLY_LOGLEVEL}" --direct
SH
  chmod +x "${conf_dir}/entry-point.sh"

  run docker network create "${DOCKER_NETWORK}"
  ensure_sally_image
  run docker run -d --rm --name "${SALLY_VLEI_CONTAINER}" --network "${DOCKER_NETWORK}" -p "${SALLY_VLEI_PORT}:7723" \
    "${SALLY_VLEI_IMAGE}" vLEI-server -s /vLEI/schema -c /vLEI/credentials -o /vLEI/oobis
  wait_http "http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${QVI_SCHEMA}" 120

  run docker run -d --rm --name "${SALLY_HOOK_CONTAINER}" --network "${DOCKER_NETWORK}" -p "${SALLY_HOOK_PORT}:9923" \
    "${SALLY_IMAGE}" sally hook demo
  wait_http "http://127.0.0.1:${SALLY_HOOK_PORT}/health" 120

  run docker run -d --rm --name "${SALLY_CONTAINER}" --network "${DOCKER_NETWORK}" -p "${SALLY_PORT}:9723" \
    -v "${conf_dir}:/sally/conf" \
    -v "${sally_var}:/usr/local/var/keri" \
    -e SALLY=direct-sally \
    -e SALLY_SALT=0ABVqAtad0CBkhDhCEPd514T \
    -e SALLY_PASSCODE=4TBjjhmKu9oeDp49J7Xdy \
    -e "SALLY_LOGLEVEL=${SALLY_LOGLEVEL}" \
    -e "WEBHOOK_HOST=http://${SALLY_HOOK_CONTAINER}:9923/" \
    -e "GEDA_PRE=${GEDA_PRE}" \
    --entrypoint /bin/bash \
    "${SALLY_IMAGE}" /sally/conf/entry-point.sh
  wait_http "http://127.0.0.1:${SALLY_PORT}/health" 120

  local i logs
  for i in $(seq 1 60); do
    logs="$(docker logs "${SALLY_CONTAINER}" 2>&1 || true)"
    SALLY_PRE="$(printf '%s\n' "${logs}" | sed -nE 's/.*Using hab [^:[:space:]]+:(E[A-Za-z0-9_-]+).*/\1/p' | tail -1)"
    [[ -n "${SALLY_PRE:-}" ]] && break
    sleep 1
  done
  [[ -n "${SALLY_PRE:-}" ]] || fail "unable to parse Sally AID from logs"
  SALLY_OOBI="http://127.0.0.1:${SALLY_PORT}/oobi/${SALLY_PRE}/controller"
  log "Sally AID ${SALLY_PRE}"
  log "Sally delivery counter profile ${SALLY_COUNTER_PROFILE}"
}

main() {
  require_cmd jq
  require_cmd curl
  require_cmd docker
  require_cmd python3
  [[ -x "${KLI_CMD}" ]] || fail "KLI command is not executable: ${KLI_CMD}"
  mkdir -p "${RUN_DIR}" "${LOG_DIR}" "${TUFA_HEAD}" "${KLI_CONFIG_DIR}/keri/cf"
  log "run dir: ${RUN_DIR}"

  log "starting KERIpy demo witnesses"
  start_bg kli-witness-demo "${LOG_DIR}/kli-witness-demo.log" bash -lc "cd '${KERIPY_DIR}' && '${KLI_CMD}' witness demo --base '${KERI_BASE}'"
  wait_http "${WAN_OOBI}" 90

  local tw1_http tw1_tcp tw2_http tw2_tcp tw1_log tw2_log
  tw1_http="$(random_port)"
  tw1_tcp="$(random_port)"
  tw2_http="$(random_port)"
  tw2_tcp="$(random_port)"
  run tufa init -n tw1 --head-dir "${TUFA_HEAD}" --nopasscode
  run tufa init -n tw2 --head-dir "${TUFA_HEAD}" --nopasscode
  tw1_log="${LOG_DIR}/tufa-witness-tw1.log"
  tw2_log="${LOG_DIR}/tufa-witness-tw2.log"
  start_bg tufa-witness-tw1 "${tw1_log}" "${TUFACMD[@]}" witness start -n tw1 -a tw1 --head-dir "${TUFA_HEAD}" -u "http://127.0.0.1:${tw1_http}/" --tcp-url "tcp://127.0.0.1:${tw1_tcp}/" -H "${tw1_http}" -T "${tw1_tcp}"
  start_bg tufa-witness-tw2 "${tw2_log}" "${TUFACMD[@]}" witness start -n tw2 -a tw2 --head-dir "${TUFA_HEAD}" -u "http://127.0.0.1:${tw2_http}/" --tcp-url "tcp://127.0.0.1:${tw2_tcp}/" -H "${tw2_http}" -T "${tw2_tcp}"
  local tw1_pid tw2_pid
  tw1_pid="${PIDS[$((${#PIDS[@]} - 2))]}"
  tw2_pid="${PIDS[$((${#PIDS[@]} - 1))]}"
  wait_for_log "${tw1_log}" 'Witness Prefix' 90 "${tw1_pid}"
  wait_for_log "${tw2_log}" 'Witness Prefix' 90 "${tw2_pid}"
  TW1_PRE="$(awk '/Witness Prefix/ { print $3 }' "${tw1_log}" | tail -1)"
  TW2_PRE="$(awk '/Witness Prefix/ { print $3 }' "${tw2_log}" | tail -1)"
  TW1_OOBI="$(awk '/Witness OOBI/ { print $3 }' "${tw1_log}" | tail -1)"
  TW2_OOBI="$(awk '/Witness OOBI/ { print $3 }' "${tw2_log}" | tail -1)"
  TW1_MAILBOX_OOBI="$(awk '/Mailbox OOBI/ { print $3 }' "${tw1_log}" | tail -1)"
  TW2_MAILBOX_OOBI="$(awk '/Mailbox OOBI/ { print $3 }' "${tw2_log}" | tail -1)"

  log "starting LE KERIpy mailbox"
  local le_mbx_port le_mbx_log
  le_mbx_port="$(random_port)"
  cat >"${KLI_CONFIG_DIR}/keri/cf/le-mbx.json" <<JSON
{
  "le-relay": {
    "dt": "2026-06-08T00:00:00.000000+00:00",
    "curls": ["http://127.0.0.1:${le_mbx_port}/"]
  }
}
JSON
  run "${KLI_CMD}" init -n le-mbx -b "${KERI_BASE}" --nopasscode --config-dir "${KLI_CONFIG_DIR}" --config-file le-mbx
  le_mbx_log="${LOG_DIR}/keripy-le-mailbox.log"
  start_bg keripy-le-mailbox "${le_mbx_log}" "${KLI_CMD}" mailbox start -n le-mbx -b "${KERI_BASE}" -a le-relay --config-dir "${KLI_CONFIG_DIR}" --config-file le-mbx -H "${le_mbx_port}"
  wait_http "http://127.0.0.1:${le_mbx_port}/health" 90
  capture LE_MAILBOX_PRE "${KLI_CMD}" aid -n le-mbx -b "${KERI_BASE}" -a le-relay
  LE_MAILBOX_PRE="$(printf '%s\n' "${LE_MAILBOX_PRE}" | awk 'NF { line=$0 } END { print line }')"
  capture LE_MAILBOX_OOBI "${KLI_CMD}" oobi generate -n le-mbx -b "${KERI_BASE}" -a le-relay -r mailbox
  LE_MAILBOX_OOBI="$(printf '%s\n' "${LE_MAILBOX_OOBI}" | awk 'NF { line=$0 } END { print line }')"

  log "starting OOR tufa mailbox"
  local oor_mbx_port oor_mbx_log
  oor_mbx_port="$(random_port)"
  run tufa init -n oor-mbx --head-dir "${TUFA_HEAD}" --nopasscode
  oor_mbx_log="${LOG_DIR}/tufa-oor-mailbox.log"
  start_bg tufa-oor-mailbox "${oor_mbx_log}" "${TUFACMD[@]}" mailbox start -n oor-mbx -a oor-relay --head-dir "${TUFA_HEAD}" -u "http://127.0.0.1:${oor_mbx_port}/" --datetime "2026-06-08T00:00:00.000000+00:00" --port "${oor_mbx_port}"
  local oor_mbx_pid
  oor_mbx_pid="${PIDS[$((${#PIDS[@]} - 1))]}"
  wait_for_log "${oor_mbx_log}" 'Mailbox OOBI' 90 "${oor_mbx_pid}"
  OOR_MAILBOX_PRE="$(awk '/Mailbox Prefix/ { print $3 }' "${oor_mbx_log}" | tail -1)"
  OOR_MAILBOX_OOBI="$(awk '/Mailbox OOBI/ { print $3 }' "${oor_mbx_log}" | tail -1)"

  GEDA_WITS=("${TW1_PRE}" "${WAN_PRE}" "${WIL_PRE}")
  QVI_WITS=("${TW2_PRE}" "${WIL_PRE}" "${WES_PRE}")
  LE_WITS=("${TW1_PRE}" "${WES_PRE}" "${WAN_PRE}")
  OOR_WITS=("${TW2_PRE}" "${WAN_PRE}" "${WES_PRE}")
  GEDA_WIT_OOBIS=("tw1|${TW1_PRE}|${TW1_OOBI}" "wan|${WAN_PRE}|${WAN_OOBI}" "wil|${WIL_PRE}|${WIL_OOBI}")
  QVI_WIT_OOBIS=("tw2|${TW2_PRE}|${TW2_OOBI}" "wil|${WIL_PRE}|${WIL_OOBI}" "wes|${WES_PRE}|${WES_OOBI}")
  LE_WIT_OOBIS=("tw1|${TW1_PRE}|${TW1_OOBI}" "wes|${WES_PRE}|${WES_OOBI}" "wan|${WAN_PRE}|${WAN_OOBI}")
  OOR_WIT_OOBIS=("tw2|${TW2_PRE}|${TW2_OOBI}" "wan|${WAN_PRE}|${WAN_OOBI}" "wes|${WES_PRE}|${WES_OOBI}")

  for store in geda1 geda2 qvi1 qvi2 le1 le2 oor; do
    run tufa init -n "${store}" --head-dir "${TUFA_HEAD}" --nopasscode
  done

  resolve_witnesses geda1 "${GEDA_WIT_OOBIS[@]}"
  resolve_witnesses geda2 "${GEDA_WIT_OOBIS[@]}"
  resolve_witnesses qvi1 "${QVI_WIT_OOBIS[@]}"
  resolve_witnesses qvi2 "${QVI_WIT_OOBIS[@]}"
  resolve_witnesses le1 "${LE_WIT_OOBIS[@]}"
  resolve_witnesses le2 "${LE_WIT_OOBIS[@]}"
  resolve_witnesses oor "${OOR_WIT_OOBIS[@]}"

  incept_tufa_aid geda1 geda-m1 "${GEDA_WITS[@]}"
  incept_tufa_aid geda2 geda-m2 "${GEDA_WITS[@]}"
  incept_tufa_aid qvi1 qvi-m1 "${QVI_WITS[@]}"
  incept_tufa_aid qvi2 qvi-m2 "${QVI_WITS[@]}"
  incept_tufa_aid le1 le-m1 "${LE_WITS[@]}"
  incept_tufa_aid le2 le-m2 "${LE_WITS[@]}"
  incept_tufa_aid oor oor "${OOR_WITS[@]}"

  add_mailbox geda1 geda-m1 "${TW1_MAILBOX_OOBI}" geda-witness-mailbox
  add_mailbox geda2 geda-m2 "${TW1_MAILBOX_OOBI}" geda-witness-mailbox
  add_mailbox qvi1 qvi-m1 "${TW2_MAILBOX_OOBI}" qvi-witness-mailbox
  add_mailbox qvi2 qvi-m2 "${TW2_MAILBOX_OOBI}" qvi-witness-mailbox
  add_mailbox le1 le-m1 "${LE_MAILBOX_OOBI}" le-keripy-mailbox
  add_mailbox le2 le-m2 "${LE_MAILBOX_OOBI}" le-keripy-mailbox
  add_mailbox oor oor "${OOR_MAILBOX_OOBI}" oor-tufa-mailbox

  GEDA_M1_OOBIS="$(witness_oobis geda1 geda-m1)"
  GEDA_M2_OOBIS="$(witness_oobis geda2 geda-m2)"
  QVI_M1_OOBIS="$(witness_oobis qvi1 qvi-m1)"
  QVI_M2_OOBIS="$(witness_oobis qvi2 qvi-m2)"
  LE_M1_OOBIS="$(witness_oobis le1 le-m1)"
  LE_M2_OOBIS="$(witness_oobis le2 le-m2)"
  GEDA_M1_MBOX="$(mailbox_oobi geda1 geda-m1)"
  GEDA_M2_MBOX="$(mailbox_oobi geda2 geda-m2)"
  QVI_M1_MBOX="$(mailbox_oobi qvi1 qvi-m1)"
  QVI_M2_MBOX="$(mailbox_oobi qvi2 qvi-m2)"
  LE_M1_MBOX="$(mailbox_oobi le1 le-m1)"
  LE_M2_MBOX="$(mailbox_oobi le2 le-m2)"
  resolve_oobi_lines geda1 geda-m2 "${GEDA_M2_OOBIS}"
  resolve_oobi geda1 "${GEDA_M2_MBOX}" geda-m2
  resolve_oobi_lines geda2 geda-m1 "${GEDA_M1_OOBIS}"
  resolve_oobi geda2 "${GEDA_M1_MBOX}" geda-m1
  resolve_oobi_lines qvi1 qvi-m2 "${QVI_M2_OOBIS}"
  resolve_oobi qvi1 "${QVI_M2_MBOX}" qvi-m2
  resolve_oobi_lines qvi2 qvi-m1 "${QVI_M1_OOBIS}"
  resolve_oobi qvi2 "${QVI_M1_MBOX}" qvi-m1
  resolve_oobi_lines le1 le-m2 "${LE_M2_OOBIS}"
  resolve_oobi le1 "${LE_M2_MBOX}" le-m2
  resolve_oobi_lines le2 le-m1 "${LE_M1_OOBIS}"
  resolve_oobi le2 "${LE_M1_MBOX}" le-m1

  multisig_round geda geda1 geda-m1 geda2 geda-m2 geda "${GEDA_WITS[@]}"
  GEDA_PRE="$(aid geda1 geda)"
  multisig_rpy_round geda1 geda2 geda "${TW1_PRE}"
  add_mailbox geda1 geda "${TW1_MAILBOX_OOBI}" geda-witness-mailbox
  add_mailbox geda2 geda "${TW1_MAILBOX_OOBI}" geda-witness-mailbox
  GEDA_MBOX="$(mailbox_oobi geda1 geda)"
  resolve_oobi qvi1 "${GEDA_MBOX}" geda
  resolve_oobi qvi2 "${GEDA_MBOX}" geda

  delegated_qvi_multisig_round
  multisig_round le le1 le-m1 le2 le-m2 le "${LE_WITS[@]}"
  QVI_PRE="$(aid qvi1 qvi)"
  LE_PRE="$(aid le1 le)"
  OOR_PRE="$(aid oor oor)"

  multisig_rpy_round qvi1 qvi2 qvi "${TW2_PRE}"
  multisig_rpy_round le1 le2 le "${LE_MAILBOX_PRE}"
  add_mailbox qvi1 qvi "${TW2_MAILBOX_OOBI}" qvi-witness-mailbox
  add_mailbox qvi2 qvi "${TW2_MAILBOX_OOBI}" qvi-witness-mailbox
  add_mailbox le1 le "${LE_MAILBOX_OOBI}" le-keripy-mailbox
  add_mailbox le2 le "${LE_MAILBOX_OOBI}" le-keripy-mailbox

  QVI_MBOX="$(mailbox_oobi qvi1 qvi)"
  LE_MBOX="$(mailbox_oobi le1 le)"
  OOR_MBOX="$(mailbox_oobi oor oor)"

  for store in geda1 geda2 qvi1 qvi2 le1 le2 oor; do
    import_schemas "${store}"
  done

  resolve_oobi geda1 "${QVI_MBOX}" qvi
  resolve_oobi geda2 "${QVI_MBOX}" qvi
  resolve_oobi qvi1 "${GEDA_MBOX}" geda
  resolve_oobi qvi2 "${GEDA_MBOX}" geda
  resolve_oobi qvi1 "${LE_MBOX}" le
  resolve_oobi qvi2 "${LE_MBOX}" le
  resolve_oobi le1 "${QVI_MBOX}" qvi
  resolve_oobi le2 "${QVI_MBOX}" qvi
  resolve_oobi le1 "${GEDA_MBOX}" geda
  resolve_oobi le2 "${GEDA_MBOX}" geda
  resolve_oobi qvi1 "${OOR_MBOX}" oor
  resolve_oobi qvi2 "${OOR_MBOX}" oor
  resolve_oobi oor "${QVI_MBOX}" qvi

  registry_round geda1 geda2 geda vLEI-external
  registry_round qvi1 qvi2 qvi vLEI-qvi
  registry_round le1 le2 le vLEI-internal

  local rules oor_rules
  rules="$(rules_path rules.json)"
  oor_rules="$(rules_path oor-rules.json)"

  printf '{"LEI":"%s"}\n' "${LE_LEI}" >"${RUN_DIR}/qvi-data.json"
  credential_round QVI_CRED geda1 geda2 geda vLEI-external "${QVI_SCHEMA}" "${QVI_PRE}" "${RUN_DIR}/qvi-data.json" "" "${rules}"
  grant_group_credential geda1 geda2 geda "${QVI_PRE}" "${QVI_CRED}"
  poll_saved qvi1 qvi "${QVI_CRED}"
  poll_saved qvi2 qvi "${QVI_CRED}"

  jq -n --arg n "${QVI_CRED}" --arg s "${QVI_SCHEMA}" '{d:"", qvi:{n:$n, s:$s}}' >"${RUN_DIR}/qvi-edge.json"
  saidify_file "${RUN_DIR}/qvi-edge.json"
  printf '{"LEI":"%s"}\n' "${LE_LEI}" >"${RUN_DIR}/le-data.json"
  credential_round LE_CRED qvi1 qvi2 qvi vLEI-qvi "${LE_SCHEMA}" "${LE_PRE}" "${RUN_DIR}/le-data.json" "${RUN_DIR}/qvi-edge.json" "${rules}"
  grant_group_credential qvi1 qvi2 qvi "${LE_PRE}" "${LE_CRED}"
  poll_saved le1 le "${LE_CRED}"
  poll_saved le2 le "${LE_CRED}"

  jq -n --arg n "${LE_CRED}" --arg s "${LE_SCHEMA}" '{d:"", le:{n:$n, s:$s}}' >"${RUN_DIR}/le-edge.json"
  saidify_file "${RUN_DIR}/le-edge.json"
  jq -n --arg aid "${OOR_PRE}" --arg lei "${LE_LEI}" --arg name "${PERSON_NAME}" --arg role "${PERSON_OOR}" \
    '{AID:$aid, LEI:$lei, personLegalName:$name, officialRole:$role}' >"${RUN_DIR}/oor-auth-data.json"
  credential_round OOR_AUTH_CRED le1 le2 le vLEI-internal "${OOR_AUTH_SCHEMA}" "${QVI_PRE}" "${RUN_DIR}/oor-auth-data.json" "${RUN_DIR}/le-edge.json" "${rules}"
  grant_group_credential le1 le2 le "${QVI_PRE}" "${OOR_AUTH_CRED}"
  poll_saved qvi1 qvi "${OOR_AUTH_CRED}"
  poll_saved qvi2 qvi "${OOR_AUTH_CRED}"

  jq -n --arg n "${OOR_AUTH_CRED}" --arg s "${OOR_AUTH_SCHEMA}" '{d:"", auth:{n:$n, s:$s, o:"I2I"}}' >"${RUN_DIR}/oor-auth-edge.json"
  saidify_file "${RUN_DIR}/oor-auth-edge.json"
  jq -n --arg lei "${LE_LEI}" --arg name "${PERSON_NAME}" --arg role "${PERSON_OOR}" \
    '{LEI:$lei, personLegalName:$name, officialRole:$role}' >"${RUN_DIR}/oor-data.json"
  credential_round OOR_CRED qvi1 qvi2 qvi vLEI-qvi "${OOR_SCHEMA}" "${OOR_PRE}" "${RUN_DIR}/oor-data.json" "${RUN_DIR}/oor-auth-edge.json" "${oor_rules}"
  grant_group_credential qvi1 qvi2 qvi "${OOR_PRE}" "${OOR_CRED}"
  poll_saved oor oor "${OOR_CRED}"

  start_sally_stack
  for store in qvi1 qvi2 le1 le2 oor; do
    resolve_oobi "${store}" "${SALLY_OOBI}" sally
  done

  present_group_to_sally qvi1 qvi2 qvi "${QVI_CRED}" QVI
  present_group_to_sally le1 le2 le "${LE_CRED}" LE
  present_single_to_sally oor oor "${OOR_CRED}" OOR

  docker logs "${SALLY_HOOK_CONTAINER}" >"${LOG_DIR}/sally-hook.log" 2>&1 || true
  docker logs "${SALLY_CONTAINER}" >"${LOG_DIR}/sally.log" 2>&1 || true
  grep -q "${QVI_CRED}" "${LOG_DIR}/sally-hook.log" || fail "hook logs do not mention QVI credential"
  grep -q "${LE_CRED}" "${LOG_DIR}/sally-hook.log" || fail "hook logs do not mention LE credential"
  grep -q "${OOR_CRED}" "${LOG_DIR}/sally-hook.log" || fail "hook logs do not mention OOR credential"

  jq -n \
    --arg runDir "${RUN_DIR}" \
    --arg geda "${GEDA_PRE}" \
    --arg qvi "${QVI_PRE}" \
    --arg le "${LE_PRE}" \
    --arg oor "${OOR_PRE}" \
    --arg sally "${SALLY_PRE}" \
    --arg qviCred "${QVI_CRED}" \
    --arg leCred "${LE_CRED}" \
    --arg oorAuthCred "${OOR_AUTH_CRED}" \
    --arg oorCred "${OOR_CRED}" \
    '{status:"ok", runDir:$runDir, aids:{geda:$geda,qvi:$qvi,le:$le,oor:$oor,sally:$sally}, credentials:{qvi:$qviCred,le:$leCred,oorAuth:$oorAuthCred,oor:$oorCred}}' \
    | tee "${RUN_DIR}/vlei-tufa-sally-report.json"
}

main "$@"
