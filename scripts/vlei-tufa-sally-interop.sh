#!/usr/bin/env bash
set -euo pipefail

# Everything runs in Linux containers on named volumes. The host holds only
# this script, its logs, and the sources piped in with `git archive`.
# Tufa, KERIpy, Sally, the Sally hook and the vLEI schema server share the
# network namespace of the Tufa container, so every endpoint is 127.0.0.1.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KERIPY_INTEROP_REPO="${KERIPY_INTEROP_REPO:-https://github.com/kentbull/keripy.git}"
KERIPY_INTEROP_COMMIT="${KERIPY_INTEROP_COMMIT:-98b88cf73a746813a8719f05264400467a474c05}"
KERIPY_INTEROP_INSTALL="git+${KERIPY_INTEROP_REPO}@${KERIPY_INTEROP_COMMIT}"
KERIPY_BASE_IMAGE="${KERIPY_BASE_IMAGE:-python:3.14-slim}"
KERIPY_IMAGE="${KERIPY_IMAGE:-local/keripy-interop:src-${KERIPY_INTEROP_COMMIT:0:12}}"
TUFA_TEST_IMAGE="${TUFA_TEST_IMAGE:-local/keri-ts-test:latest}"

RUN_ID="${RUN_ID:-vlei-tufa-sally-$(date +%Y%m%d%H%M%S)-$RANDOM}"
SUFFIX="${RUN_ID##*-}"
HOST_RUN_DIR="${HOST_RUN_DIR:-${TMPDIR:-/tmp}/${RUN_ID}}"
LOG_DIR="${HOST_RUN_DIR}/logs"
RUN_DIR="/work/run"
TUFA_REPO_DIR="/work/repo"
TUFA_HEAD="${RUN_DIR}/tufa"
KLI_CONFIG_DIR="/work/keripy-config"
TUFA_CONTAINER="tufa-sally-tufa-${SUFFIX}"
KERIPY_CONTAINER="tufa-sally-keripy-${SUFFIX}"
WORK_VOLUME="tufa-sally-work-${SUFFIX}"
KERIPY_WORK_VOLUME="tufa-sally-keripy-work-${SUFFIX}"
KERIPY_STATE_VOLUME="tufa-sally-keripy-state-${SUFFIX}"
DENO_CACHE_VOLUME="${DENO_CACHE_VOLUME:-tufa-sally-deno-cache}"
SALLY_CONF_VOLUME="tufa-sally-conf-${SUFFIX}"
SALLY_VAR_VOLUME="tufa-sally-var-${SUFFIX}"
KERI_BASE="${KERI_BASE:-${RUN_ID}}"
KEEP_RUN_DIR="${KEEP_RUN_DIR:-true}"
SALLY_VLEI_IMAGE="${SALLY_VLEI_IMAGE:-gleif/vlei:1.0.3}"
# 0.9.0 lacks --salt, --incept-file and --direct, which this script needs.
SALLY_IMAGE="${SALLY_IMAGE:-gleif/sally:1.0.11}"
SALLY_LOGLEVEL="${SALLY_LOGLEVEL:-DEBUG}"
SALLY_GVRSN="${SALLY_GVRSN:-1.0}"
# Sally 0.9.0 and the pinned KERIpy are KERI 1.0 peers; Tufa defaults new KELs to 2.0.
KERI_VERSION="${KERI_VERSION:-1.0}"
SALLY_NAME="${SALLY_NAME:-sally}"
SALLY_ALIAS="${SALLY_ALIAS:-${SALLY_NAME}}"
SALLY_CONFIG_FILE="${SALLY_CONFIG_FILE:-${SALLY_NAME}}"
SALLY_SALT="${SALLY_SALT:-0ABVqAtad0CBkhDhCEPd514T}"
SALLY_PASSCODE="${SALLY_PASSCODE:-4TBjjhmKu9oeDp49J7Xdy}"
SALLY_PRE="${SALLY_PRE:-EBbCO10AWGD9OPEEEbC0iYaxFuilR4hA6-xEyjJTjd6K}"

VLEI_SCHEMA_REPO="${VLEI_SCHEMA_REPO:-https://github.com/GLEIF-IT/vLEI-schema.git}"
VLEI_SCHEMA_COMMIT="${VLEI_SCHEMA_COMMIT:-97850396f504bf8c4e19a42af3290e4b2618f50e}"
VLEI_SCHEMA_RAW_BASE="${VLEI_SCHEMA_RAW_BASE:-https://raw.githubusercontent.com/GLEIF-IT/vLEI-schema/${VLEI_SCHEMA_COMMIT}}"
VLEI_RULES_REPO="${VLEI_RULES_REPO:-https://github.com/WebOfTrust/signifypy.git}"
VLEI_RULES_COMMIT="${VLEI_RULES_COMMIT:-294b5ba6a325b39a209bfd58f6751d17dde56296}"
VLEI_RULES_RAW_BASE="${VLEI_RULES_RAW_BASE:-https://raw.githubusercontent.com/WebOfTrust/signifypy/${VLEI_RULES_COMMIT}}"
VLEI_SCHEMA_DIR="${VLEI_SCHEMA_DIR:-}"
VLEI_RULES_DIR="${VLEI_RULES_DIR:-}"
MATERIALIZED_VLEI_SCHEMA_DIR="${RUN_DIR}/vlei/schema"
MATERIALIZED_VLEI_RULES_DIR="${RUN_DIR}/vlei/rules"

TUFACMD=(deno run --allow-all --unstable-ffi "${TUFA_REPO_DIR}/packages/tufa/mod.ts")
SALLY_VLEI_PORT=7723
SALLY_HOOK_PORT=9923
SALLY_PORT=9723

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
VOLUMES=()

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

  if [[ "${KEEP_RUN_DIR}" != "true" ]]; then
    for volume in "${VOLUMES[@]:-}"; do
      [[ -n "${volume}" ]] || continue
      docker volume rm "${volume}" >/dev/null 2>&1 || true
    done
  else
    log "kept volumes: ${VOLUMES[*]:-none}"
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

docker_image_exists() {
  docker image inspect "$1" >/dev/null 2>&1
}

# Run a command inside the Tufa container, from the extracted repository.
in_tufa() {
  docker exec -w "${TUFA_REPO_DIR}" "${TUFA_CONTAINER}" "$@"
}

# Write stdin to a file inside the Tufa container.
put_file() {
  docker exec -i "${TUFA_CONTAINER}" bash -c 'mkdir -p "$(dirname "$1")" && cat >"$1"' _ "$1"
}

kli() {
  docker exec "${KERIPY_CONTAINER}" kli "$@"
}

download_file() {
  local url="$1"
  local target="$2"
  in_tufa test -f "${target}" && return 0
  in_tufa mkdir -p "$(dirname "${target}")"
  log "download ${url} -> ${target}"
  in_tufa curl -fsSL "${url}" -o "${target}"
}

copy_dir_in() {
  local source="$1"
  local target="$2"
  in_tufa mkdir -p "${target}"
  docker cp "${source}/." "${TUFA_CONTAINER}:${target}"
}

prepare_vlei_fixtures() {
  if [[ -n "${VLEI_SCHEMA_DIR}" ]]; then
    log "copying override vLEI schema dir: ${VLEI_SCHEMA_DIR}"
    copy_dir_in "${VLEI_SCHEMA_DIR}" "${MATERIALIZED_VLEI_SCHEMA_DIR}"
  else
    log "materializing vLEI schemas from ${VLEI_SCHEMA_REPO}@${VLEI_SCHEMA_COMMIT}"
    download_file "${VLEI_SCHEMA_RAW_BASE}/qualified-vLEI-issuer-vLEI-credential.json" \
      "${MATERIALIZED_VLEI_SCHEMA_DIR}/qualified-vLEI-issuer-vLEI-credential.schema.json"
    download_file "${VLEI_SCHEMA_RAW_BASE}/legal-entity-vLEI-credential.json" \
      "${MATERIALIZED_VLEI_SCHEMA_DIR}/legal-entity-vLEI-credential.schema.json"
    download_file "${VLEI_SCHEMA_RAW_BASE}/oor-authorization-vlei-credential.json" \
      "${MATERIALIZED_VLEI_SCHEMA_DIR}/oor-authorization-vlei-credential.schema.json"
    download_file "${VLEI_SCHEMA_RAW_BASE}/legal-entity-official-organizational-role-vLEI-credential.json" \
      "${MATERIALIZED_VLEI_SCHEMA_DIR}/legal-entity-official-organizational-role-vLEI-credential.schema.json"
    download_file "${VLEI_SCHEMA_RAW_BASE}/ecr-authorization-vlei-credential.json" \
      "${MATERIALIZED_VLEI_SCHEMA_DIR}/ecr-authorization-vlei-credential.schema.json"
    download_file "${VLEI_SCHEMA_RAW_BASE}/legal-entity-engagement-context-role-vLEI-credential.json" \
      "${MATERIALIZED_VLEI_SCHEMA_DIR}/legal-entity-engagement-context-role-vLEI-credential.schema.json"
  fi

  if [[ -n "${VLEI_RULES_DIR}" ]]; then
    log "copying override vLEI rules dir: ${VLEI_RULES_DIR}"
    copy_dir_in "${VLEI_RULES_DIR}" "${MATERIALIZED_VLEI_RULES_DIR}"
  else
    log "materializing vLEI rules from ${VLEI_RULES_REPO}@${VLEI_RULES_COMMIT}"
    download_file "${VLEI_RULES_RAW_BASE}/scripts/data/rules.json" \
      "${MATERIALIZED_VLEI_RULES_DIR}/rules.json"
    download_file "${VLEI_RULES_RAW_BASE}/tests/schema/rules/oor-rules.json" \
      "${MATERIALIZED_VLEI_RULES_DIR}/oor-rules.json"
  fi
}

# Build the pinned KERIpy image from a Dockerfile on stdin; no build context.
ensure_keripy_image() {
  if docker_image_exists "${KERIPY_IMAGE}"; then
    log "using cached KERIpy image ${KERIPY_IMAGE}"
    return 0
  fi
  log "building ${KERIPY_IMAGE}: ${KERIPY_INTEROP_REPO}@${KERIPY_INTEROP_COMMIT}"
  docker build -t "${KERIPY_IMAGE}" - <<DOCKER
FROM ${KERIPY_BASE_IMAGE}
RUN apt-get update \
 && apt-get install -y --no-install-recommends git build-essential libsodium23 curl \
 && rm -rf /var/lib/apt/lists/*
# \`kli witness demo\` reads scripts/keri/cf/main/*.json relative to its working
# directory, so keep the pinned source tree and run KERIpy from it.
RUN git init -q /keripy \
 && git -C /keripy fetch -q --depth 1 "${KERIPY_INTEROP_REPO}" "${KERIPY_INTEROP_COMMIT}" \
 && git -C /keripy checkout -q FETCH_HEAD \
 && pip install --no-cache-dir /keripy
WORKDIR /keripy
DOCKER
}

# Start the Tufa and KERIpy containers on named volumes and copy the committed
# HEAD of this repository into the Tufa container. The Tufa container owns the
# network namespace the other containers join.
start_tool_containers() {
  VOLUMES+=("${WORK_VOLUME}" "${KERIPY_WORK_VOLUME}" "${KERIPY_STATE_VOLUME}" "${SALLY_CONF_VOLUME}" "${SALLY_VAR_VOLUME}")
  DOCKER_CONTAINERS+=("${TUFA_CONTAINER}" "${KERIPY_CONTAINER}")
  run docker run -d --init --name "${TUFA_CONTAINER}" \
    -v "${WORK_VOLUME}:/work" \
    -v "${DENO_CACHE_VOLUME}:/deno-cache" \
    -e DENO_DIR=/deno-cache \
    "${TUFA_TEST_IMAGE}" sleep infinity
  run docker run -d --init --name "${KERIPY_CONTAINER}" \
    --network "container:${TUFA_CONTAINER}" \
    -v "${KERIPY_WORK_VOLUME}:/work" \
    -v "${KERIPY_STATE_VOLUME}:/usr/local/var/keri" \
    "${KERIPY_IMAGE}" sleep infinity

  log "copying committed HEAD $(git -C "${ROOT_DIR}" rev-parse --short HEAD) into ${TUFA_CONTAINER}"
  docker exec "${TUFA_CONTAINER}" mkdir -p "${TUFA_REPO_DIR}" "${RUN_DIR}"
  git -C "${ROOT_DIR}" archive --format=tar HEAD | docker exec -i "${TUFA_CONTAINER}" tar -x -C "${TUFA_REPO_DIR}"
  in_tufa deno install >/dev/null 2>&1 || true
  run in_tufa deno task setup:compat-lmdb
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
    if in_tufa curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  fail "timed out waiting for ${url}"
}

wait_container_log() {
  local container="$1"
  local pattern="$2"
  local timeout="${3:-60}"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if docker logs "${container}" 2>&1 | grep -qF "${pattern}"; then
      return 0
    fi
    sleep 0.5
  done
  docker logs "${container}" >&2 || true
  fail "timed out waiting for ${pattern} in ${container} logs"
}

# Pick a port that nothing in the shared container network namespace uses.
random_port() {
  local port
  for _ in {1..50}; do
    port=$((49152 + RANDOM % 16384))
    if ! in_tufa bash -c "exec 3<>/dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1; then
      printf '%s\n' "${port}"
      return 0
    fi
  done
  fail "could not allocate an unused local port"
}

tufa() {
  in_tufa "${TUFACMD[@]}" "$@"
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
  printf '%s/%s\n' "${MATERIALIZED_VLEI_SCHEMA_DIR}" "$1"
}

rules_path() {
  printf '%s/%s\n' "${MATERIALIZED_VLEI_RULES_DIR}" "$1"
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
  local args=(incept -n "${store}" --head-dir "${TUFA_HEAD}" -a "${alias}" -tf -t 2 --version "${KERI_VERSION}" --receipt-endpoint)
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
    | put_file "${cfg}"

  run tufa multisig incept -n "${store1}" --head-dir "${TUFA_HEAD}" -a "${member1}" -g "${group}" -f "${cfg}" --version "${KERI_VERSION}" --approval-timeout 1
  run tufa multisig join -n "${store2}" --head-dir "${TUFA_HEAD}" -g "${group}" -Y --approval-timeout 120 --receipt-endpoint
  run tufa multisig join -n "${store1}" --head-dir "${TUFA_HEAD}" -g "${group}" -Y --approval-timeout 120 --receipt-endpoint
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
    | put_file "${cfg}"

  geda_wit_oobis="$(witness_oobis geda1 geda)"
  resolve_oobi_lines qvi1 geda "${geda_wit_oobis}"
  resolve_oobi_lines qvi2 geda "${geda_wit_oobis}"

  qvi1_log="${LOG_DIR}/qvi-delegated-incept-qvi1.log"
  start_cmd_bg qvi1_pid qvi-delegated-incept-qvi1 "${qvi1_log}" \
    tufa multisig incept -n qvi1 --head-dir "${TUFA_HEAD}" -a qvi-m1 -g qvi -f "${cfg}" --version "${KERI_VERSION}" --proxy qvi-m1 --approval-timeout 120

  qvi2_log="${LOG_DIR}/qvi-delegated-join-qvi2.log"
  start_cmd_bg qvi2_pid qvi-delegated-join-qvi2 "${qvi2_log}" \
    tufa multisig join -n qvi2 --head-dir "${TUFA_HEAD}" -g qvi -Y --approval-timeout 120 --receipt-endpoint --proxy qvi-m2

  run tufa delegate confirm -n geda1 --head-dir "${TUFA_HEAD}" -a geda --interact --auto --timeout 120
  run tufa multisig join -n geda2 --head-dir "${TUFA_HEAD}" -g geda -Y --approval-timeout 120 --receipt-endpoint
  run tufa multisig join -n geda1 --head-dir "${TUFA_HEAD}" -g geda -Y --approval-timeout 120 --receipt-endpoint
  wait_cmd_bg "${qvi2_pid}" "${qvi2_log}"
  wait_cmd_bg "${qvi1_pid}" "${qvi1_log}"
  qvi_pre="$(sed -n '/^{/p' "${qvi1_log}" | tail -1 | jq -r '.group // empty')"
  [[ -n "${qvi_pre}" && "${qvi_pre}" != "null" ]] || fail "unable to parse delegated QVI prefix"
  anchor_file="${RUN_DIR}/qvi-delegation-anchor.json"
  jq -n --arg i "${qvi_pre}" '{i: $i, s: "0", d: $i}' | put_file "${anchor_file}"
  run tufa query -n qvi1 --head-dir "${TUFA_HEAD}" -a qvi-m1 --prefix "${GEDA_PRE}" --anchor "${anchor_file}"
  run tufa query -n qvi2 --head-dir "${TUFA_HEAD}" -a qvi-m2 --prefix "${GEDA_PRE}" --anchor "${anchor_file}"
  assert_delegated_from qvi1 qvi-m1 "${qvi_pre}" "${GEDA_PRE}"
  assert_delegated_from qvi2 qvi-m2 "${qvi_pre}" "${GEDA_PRE}"
}

# The proposing member's command waits for the other members, so the proposer runs in
# the background while the others join; the proposer never `join`s its own proposal.
registry_round() {
  local store1="$1"
  local store2="$2"
  local group="$3"
  local registry="$4"
  local propose_log propose_pid
  propose_log="${LOG_DIR}/registry-${registry}-${store1}.log"
  start_cmd_bg propose_pid "registry-${registry}-${store1}" "${propose_log}" \
    tufa vc registry incept -n "${store1}" --head-dir "${TUFA_HEAD}" -a "${group}" --registry-name "${registry}" --usage "${registry}" --timeout 120
  run tufa multisig join -n "${store2}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}" -Y --approval-timeout 120 --receipt-endpoint
  wait_cmd_bg "${propose_pid}" "${propose_log}"
  run tufa vc registry status -n "${store1}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}"
  run tufa vc registry status -n "${store2}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}"
}

# `multisig rpy` proposes the endpoint role and waits for the other members to join it.
# Resolve the mailbox first: `oobi resolve` waits for the whole runtime to go quiet,
# and a pending group proposal keeps it busy.
multisig_mailbox_add_round() {
  local store1="$1"
  local store2="$2"
  local group="$3"
  local mailbox_oobi="$4"
  local mailbox_alias="$5"
  local propose_log propose_pid
  resolve_oobi "${store1}" "${mailbox_oobi}" "${mailbox_alias}"
  resolve_oobi "${store2}" "${mailbox_oobi}" "${mailbox_alias}"

  propose_log="${LOG_DIR}/${group}-mailbox-rpy-${store1}.log"
  start_cmd_bg propose_pid "${group}-mailbox-rpy-${store1}" "${propose_log}" \
    tufa multisig rpy -n "${store1}" --head-dir "${TUFA_HEAD}" -g "${group}" --eid "${mailbox_oobi##*/}" --role mailbox --approval-timeout 120
  run tufa multisig join -n "${store2}" --head-dir "${TUFA_HEAD}" -Y --approval-timeout 120
  wait_cmd_bg "${propose_pid}" "${propose_log}"
  run tufa mailbox add -n "${store1}" --head-dir "${TUFA_HEAD}" -a "${group}" -w "${mailbox_alias}" --multisig-mode complete
  run tufa mailbox add -n "${store2}" --head-dir "${TUFA_HEAD}" -a "${group}" -w "${mailbox_alias}" --multisig-mode complete
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
  local output args propose_log propose_pid
  args=(vc create -n "${store1}" --head-dir "${TUFA_HEAD}" -a "${group}" --registry-name "${registry}" --schema "${schema}" --recipient "${recipient}" --data "@${data_file}" --timeout 120)
  [[ -n "${edges_file}" ]] && args+=(--edges "@${edges_file}")
  [[ -n "${rules_file}" ]] && args+=(--rules "@${rules_file}")
  propose_log="${LOG_DIR}/credential-${schema}-${store1}.log"
  start_cmd_bg propose_pid "credential-${schema}-${store1}" "${propose_log}" tufa "${args[@]}"
  run tufa multisig join -n "${store2}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}" -Y --approval-timeout 120 --receipt-endpoint
  wait_cmd_bg "${propose_pid}" "${propose_log}"
  output="$(cat "${propose_log}")"
  printf -v "${__said_var}" '%s' "$(json_field "${output}" '.said')"
}

poll_saved() {
  local store="$1"
  local alias="$2"
  local said="$3"
  local out
  local i
  for i in $(seq 1 30); do
    capture out tufa ipex poll -n "${store}" --head-dir "${TUFA_HEAD}" -a "${alias}" --timeout 8
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
  local propose_log propose_pid
  propose_log="${LOG_DIR}/grant-${said}-${issuer1}.log"
  start_cmd_bg propose_pid "grant-${said}-${issuer1}" "${propose_log}" \
    tufa ipex grant -n "${issuer1}" --head-dir "${TUFA_HEAD}" -a "${group}" -r "${recipient}" --said "${said}" --approval-timeout 120
  run tufa ipex join -n "${issuer2}" --head-dir "${TUFA_HEAD}" --auto --approval-timeout 120
  wait_cmd_bg "${propose_pid}" "${propose_log}"
}

present_group_to_sally() {
  local holder1="$1"
  local holder2="$2"
  local group="$3"
  local said="$4"
  local expected="$5"
  log "presenting ${expected} ${said} from ${group} to Sally"
  local propose_log propose_pid
  propose_log="${LOG_DIR}/present-${said}-${holder1}.log"
  start_cmd_bg propose_pid "present-${said}-${holder1}" "${propose_log}" \
    tufa ipex grant -n "${holder1}" --head-dir "${TUFA_HEAD}" -a "${group}" -r "${SALLY_PRE}" --said "${said}" --approval-timeout 120 --gvrsn "${SALLY_GVRSN}"
  run tufa ipex join -n "${holder2}" --head-dir "${TUFA_HEAD}" --auto --approval-timeout 120 --gvrsn "${SALLY_GVRSN}"
  wait_cmd_bg "${propose_pid}" "${propose_log}"
  wait_hook "${expected}" "${said}"
}

present_single_to_sally() {
  local store="$1"
  local alias="$2"
  local said="$3"
  local expected="$4"
  run tufa ipex grant -n "${store}" --head-dir "${TUFA_HEAD}" -a "${alias}" -r "${SALLY_PRE}" --said "${said}" --gvrsn "${SALLY_GVRSN}"
  wait_hook "${expected}" "${said}"
}

# The stock `sally hook demo` only prints each posted webhook body, so a presentation is
# recorded once the credential SAID shows up in the hook container's log.
wait_hook() {
  local expected="$1"
  local said="$2"
  local i
  for i in $(seq 1 90); do
    if docker logs "${SALLY_HOOK_CONTAINER}" 2>&1 | grep -qF "${said}"; then
      return 0
    fi
    sleep 1
  done
  capture_docker_logs
  docker logs "${SALLY_HOOK_CONTAINER}" >&2 || true
  docker logs "${SALLY_CONTAINER}" >&2 || true
  fail "Sally hook did not record ${expected} credential ${said}"
}

assert_sally_oobi_endpoint_replies() {
  local bytes="${RUN_DIR}/sally-oobi.cesr"
  local annotated="${RUN_DIR}/sally-oobi.annotated"
  local annotated_text

  log "verifying Sally OOBI includes signed endpoint replies"
  if ! in_tufa curl -fsS -o "${bytes}" "${SALLY_OOBI}"; then
    capture_docker_logs
    fail "unable to fetch Sally OOBI ${SALLY_OOBI}"
  fi
  if ! tufa annotate --in "${bytes}" --out "${annotated}" --pretty; then
    capture_docker_logs
    fail "unable to annotate Sally OOBI ${SALLY_OOBI}"
  fi
  annotated_text="$(in_tufa cat "${annotated}")"

  if ! grep -Eq '"r"[[:space:]]*:[[:space:]]*"/loc/scheme"' <<<"${annotated_text}"; then
    printf '%s\n' "${annotated_text}" | sed -n '1,220p' >&2
    capture_docker_logs
    fail "Sally OOBI ${SALLY_OOBI} is missing /loc/scheme"
  fi
  if ! grep -Eq '"url"[[:space:]]*:[[:space:]]*"http://127\.0\.0\.1:'"${SALLY_PORT}"'/"' <<<"${annotated_text}"; then
    printf '%s\n' "${annotated_text}" | sed -n '1,220p' >&2
    capture_docker_logs
    fail "Sally /loc/scheme does not advertise host-reachable curl http://127.0.0.1:${SALLY_PORT}/"
  fi
  if ! grep -Eq '"r"[[:space:]]*:[[:space:]]*"/end/role/add"' <<<"${annotated_text}"; then
    printf '%s\n' "${annotated_text}" | sed -n '1,220p' >&2
    capture_docker_logs
    fail "Sally OOBI ${SALLY_OOBI} is missing /end/role/add"
  fi
  if ! grep -Eq '"role"[[:space:]]*:[[:space:]]*"controller"' <<<"${annotated_text}"; then
    printf '%s\n' "${annotated_text}" | sed -n '1,220p' >&2
    capture_docker_logs
    fail "Sally /end/role/add does not advertise the controller role"
  fi
}

ensure_sally_image() {
  docker_image_exists "${SALLY_IMAGE}" || run docker pull "${SALLY_IMAGE}"
}

start_sally_stack() {
  # Staging directory on the host only as a `docker cp` source; it is never mounted.
  local conf_dir="${HOST_RUN_DIR}/sally-conf"
  local conf_cf_dir="${conf_dir}/keri/cf"
  mkdir -p "${conf_cf_dir}"
  ensure_sally_image
  SALLY_VLEI_CONTAINER="tufa-vlei-${SUFFIX}"
  SALLY_HOOK_CONTAINER="tufa-sally-hook-${SUFFIX}"
  SALLY_CONTAINER="tufa-sally-${SUFFIX}"
  DOCKER_CONTAINERS+=("${SALLY_CONTAINER}" "${SALLY_HOOK_CONTAINER}" "${SALLY_VLEI_CONTAINER}")

  [[ "${SALLY_NAME}" == "${SALLY_ALIAS}" ]] || fail "Sally name ${SALLY_NAME} must match alias ${SALLY_ALIAS} for deterministic config loading"
  [[ "${SALLY_CONFIG_FILE}" == "${SALLY_NAME}" ]] || fail "Sally config file ${SALLY_CONFIG_FILE} must match name/alias ${SALLY_NAME}"

  cat >"${conf_cf_dir}/${SALLY_CONFIG_FILE}.json" <<JSON
{
  "dt": "2022-10-31T12:59:57.823350+00:00",
  "${SALLY_NAME}": {
    "dt": "2022-01-20T12:57:59.823350+00:00",
    "curls": ["http://127.0.0.1:${SALLY_PORT}/"]
  },
  "iurls": [],
  "durls": [
    "http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${OOR_SCHEMA}",
    "http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${ECR_AUTH_SCHEMA}",
    "http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${OOR_AUTH_SCHEMA}",
    "http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${LE_SCHEMA}",
    "http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${QVI_SCHEMA}",
    "http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${ECR_SCHEMA}"
  ]
}
JSON
  cat >"${conf_dir}/schema-oobis.txt" <<SCHEMAOOBIS
http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${OOR_SCHEMA}
http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${ECR_AUTH_SCHEMA}
http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${OOR_AUTH_SCHEMA}
http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${LE_SCHEMA}
http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${QVI_SCHEMA}
http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${ECR_SCHEMA}
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
sally server start --name "${SALLY_NAME}" --alias "${SALLY_ALIAS}" --passcode "${SALLY_PASSCODE}" --salt "${SALLY_SALT}" --config-dir /sally/conf --config-file "${SALLY_CONFIG_FILE}" --incept-file sally-incept-no-wits.json --web-hook "${WEBHOOK_HOST}" --auth "${GEDA_PRE}" --loglevel "${SALLY_LOGLEVEL}" --direct
SH
  chmod +x "${conf_dir}/entry-point.sh"

  run docker run -d --rm --name "${SALLY_VLEI_CONTAINER}" --network "container:${TUFA_CONTAINER}" \
    "${SALLY_VLEI_IMAGE}" vLEI-server -s /vLEI/schema -c /vLEI/credentials -o /vLEI/oobis
  wait_http "http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${QVI_SCHEMA}" 120

  run docker run -d --rm --name "${SALLY_HOOK_CONTAINER}" --network "container:${TUFA_CONTAINER}" \
    --entrypoint sally "${SALLY_IMAGE}" hook demo
  wait_container_log "${SALLY_HOOK_CONTAINER}" "listening on ${SALLY_HOOK_PORT}" 120

  run docker create --name "${SALLY_CONTAINER}" --network "container:${TUFA_CONTAINER}" \
    -v "${SALLY_CONF_VOLUME}:/sally/conf" \
    -v "${SALLY_VAR_VOLUME}:/usr/local/var/keri" \
    -e "SALLY_NAME=${SALLY_NAME}" \
    -e "SALLY_ALIAS=${SALLY_ALIAS}" \
    -e "SALLY_CONFIG_FILE=${SALLY_CONFIG_FILE}" \
    -e "SALLY_SALT=${SALLY_SALT}" \
    -e "SALLY_PASSCODE=${SALLY_PASSCODE}" \
    -e "SALLY_LOGLEVEL=${SALLY_LOGLEVEL}" \
    -e "WEBHOOK_HOST=http://127.0.0.1:${SALLY_HOOK_PORT}/" \
    -e "GEDA_PRE=${GEDA_PRE}" \
    --entrypoint /bin/bash \
    "${SALLY_IMAGE}" /sally/conf/entry-point.sh
  run docker cp "${conf_dir}/." "${SALLY_CONTAINER}:/sally/conf"
  run docker start "${SALLY_CONTAINER}"
  wait_http "http://127.0.0.1:${SALLY_PORT}/health" 120

  local i logs observed_sally_pre
  for i in $(seq 1 60); do
    logs="$(docker logs "${SALLY_CONTAINER}" 2>&1 || true)"
    observed_sally_pre="$(printf '%s\n' "${logs}" | sed -nE 's/.*Using hab [^:[:space:]]+:(E[A-Za-z0-9_-]+).*/\1/p' | tail -1)"
    [[ -n "${observed_sally_pre:-}" ]] && break
    sleep 1
  done
  [[ -n "${observed_sally_pre:-}" ]] || fail "unable to parse Sally AID from logs"
  [[ "${observed_sally_pre}" == "${SALLY_PRE}" ]] || fail "Sally AID ${observed_sally_pre} did not match expected deterministic AID ${SALLY_PRE}"
  SALLY_OOBI="http://127.0.0.1:${SALLY_PORT}/oobi/${SALLY_PRE}/controller"
  log "Sally AID ${SALLY_PRE}"
  log "Sally delivery attachment genus ${SALLY_GVRSN}"
  assert_sally_oobi_endpoint_replies
}

main() {
  require_cmd jq
  require_cmd git
  require_cmd docker
  mkdir -p "${HOST_RUN_DIR}" "${LOG_DIR}"
  log "host log dir: ${LOG_DIR}"
  ensure_keripy_image
  start_tool_containers
  in_tufa mkdir -p "${TUFA_HEAD}"
  docker exec "${KERIPY_CONTAINER}" mkdir -p "${KLI_CONFIG_DIR}/keri/cf"
  prepare_vlei_fixtures
  log "KERIpy source ${KERIPY_INTEROP_REPO}@${KERIPY_INTEROP_COMMIT}"
  log "KERIpy image ${KERIPY_IMAGE}"
  log "Tufa command ${TUFACMD[*]}"
  log "Sally image ${SALLY_IMAGE}"

  log "starting KERIpy demo witnesses"
  start_bg kli-witness-demo "${LOG_DIR}/kli-witness-demo.log" kli witness demo --base "${KERI_BASE}"
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
  start_bg tufa-witness-tw1 "${tw1_log}" tufa witness start --version "${KERI_VERSION}" -n tw1 -a tw1 --head-dir "${TUFA_HEAD}" -u "http://127.0.0.1:${tw1_http}/" --tcp-url "tcp://127.0.0.1:${tw1_tcp}/" -H "${tw1_http}" -T "${tw1_tcp}"
  start_bg tufa-witness-tw2 "${tw2_log}" tufa witness start --version "${KERI_VERSION}" -n tw2 -a tw2 --head-dir "${TUFA_HEAD}" -u "http://127.0.0.1:${tw2_http}/" --tcp-url "tcp://127.0.0.1:${tw2_tcp}/" -H "${tw2_http}" -T "${tw2_tcp}"
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
  docker exec -i "${KERIPY_CONTAINER}" tee "${KLI_CONFIG_DIR}/keri/cf/le-mbx.json" >/dev/null <<JSON
{
  "le-relay": {
    "dt": "2026-06-08T00:00:00.000000+00:00",
    "curls": ["http://127.0.0.1:${le_mbx_port}/"]
  }
}
JSON
  run kli init -n le-mbx -b "${KERI_BASE}" --nopasscode --config-dir "${KLI_CONFIG_DIR}" --config-file le-mbx
  le_mbx_log="${LOG_DIR}/keripy-le-mailbox.log"
  start_bg keripy-le-mailbox "${le_mbx_log}" kli mailbox start -n le-mbx -b "${KERI_BASE}" -a le-relay --config-dir "${KLI_CONFIG_DIR}" --config-file le-mbx -H "${le_mbx_port}"
  wait_http "http://127.0.0.1:${le_mbx_port}/health" 90
  capture LE_MAILBOX_PRE kli aid -n le-mbx -b "${KERI_BASE}" -a le-relay
  LE_MAILBOX_PRE="$(printf '%s\n' "${LE_MAILBOX_PRE}" | awk 'NF { line=$0 } END { print line }')"
  capture LE_MAILBOX_OOBI kli oobi generate -n le-mbx -b "${KERI_BASE}" -a le-relay -r mailbox
  LE_MAILBOX_OOBI="$(printf '%s\n' "${LE_MAILBOX_OOBI}" | awk 'NF { line=$0 } END { print line }')"

  log "starting OOR tufa mailbox"
  local oor_mbx_port oor_mbx_log
  oor_mbx_port="$(random_port)"
  run tufa init -n oor-mbx --head-dir "${TUFA_HEAD}" --nopasscode
  oor_mbx_log="${LOG_DIR}/tufa-oor-mailbox.log"
  start_bg tufa-oor-mailbox "${oor_mbx_log}" tufa mailbox start --version "${KERI_VERSION}" -n oor-mbx -a oor-relay --head-dir "${TUFA_HEAD}" -u "http://127.0.0.1:${oor_mbx_port}/" --datetime "2026-06-08T00:00:00.000000+00:00" --port "${oor_mbx_port}"
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
  multisig_mailbox_add_round geda1 geda2 geda "${TW1_MAILBOX_OOBI}" geda-witness-mailbox
  GEDA_MBOX="$(mailbox_oobi geda1 geda)"
  resolve_oobi qvi1 "${GEDA_MBOX}" geda
  resolve_oobi qvi2 "${GEDA_MBOX}" geda

  delegated_qvi_multisig_round
  multisig_round le le1 le-m1 le2 le-m2 le "${LE_WITS[@]}"
  QVI_PRE="$(aid qvi1 qvi)"
  LE_PRE="$(aid le1 le)"
  OOR_PRE="$(aid oor oor)"

  multisig_mailbox_add_round qvi1 qvi2 qvi "${TW2_MAILBOX_OOBI}" qvi-witness-mailbox
  multisig_mailbox_add_round le1 le2 le "${LE_MAILBOX_OOBI}" le-keripy-mailbox

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

  printf '{"LEI":"%s"}\n' "${LE_LEI}" | put_file "${RUN_DIR}/qvi-data.json"
  credential_round QVI_CRED geda1 geda2 geda vLEI-external "${QVI_SCHEMA}" "${QVI_PRE}" "${RUN_DIR}/qvi-data.json" "" "${rules}"
  grant_group_credential geda1 geda2 geda "${QVI_PRE}" "${QVI_CRED}"
  poll_saved qvi1 qvi "${QVI_CRED}"
  poll_saved qvi2 qvi "${QVI_CRED}"

  jq -n --arg n "${QVI_CRED}" --arg s "${QVI_SCHEMA}" '{d:"", qvi:{n:$n, s:$s}}' | put_file "${RUN_DIR}/qvi-edge.json"
  saidify_file "${RUN_DIR}/qvi-edge.json"
  printf '{"LEI":"%s"}\n' "${LE_LEI}" | put_file "${RUN_DIR}/le-data.json"
  credential_round LE_CRED qvi1 qvi2 qvi vLEI-qvi "${LE_SCHEMA}" "${LE_PRE}" "${RUN_DIR}/le-data.json" "${RUN_DIR}/qvi-edge.json" "${rules}"
  grant_group_credential qvi1 qvi2 qvi "${LE_PRE}" "${LE_CRED}"
  poll_saved le1 le "${LE_CRED}"
  poll_saved le2 le "${LE_CRED}"

  jq -n --arg n "${LE_CRED}" --arg s "${LE_SCHEMA}" '{d:"", le:{n:$n, s:$s}}' | put_file "${RUN_DIR}/le-edge.json"
  saidify_file "${RUN_DIR}/le-edge.json"
  jq -n --arg aid "${OOR_PRE}" --arg lei "${LE_LEI}" --arg name "${PERSON_NAME}" --arg role "${PERSON_OOR}" \
    '{AID:$aid, LEI:$lei, personLegalName:$name, officialRole:$role}' | put_file "${RUN_DIR}/oor-auth-data.json"
  credential_round OOR_AUTH_CRED le1 le2 le vLEI-internal "${OOR_AUTH_SCHEMA}" "${QVI_PRE}" "${RUN_DIR}/oor-auth-data.json" "${RUN_DIR}/le-edge.json" "${rules}"
  grant_group_credential le1 le2 le "${QVI_PRE}" "${OOR_AUTH_CRED}"
  poll_saved qvi1 qvi "${OOR_AUTH_CRED}"
  poll_saved qvi2 qvi "${OOR_AUTH_CRED}"

  jq -n --arg n "${OOR_AUTH_CRED}" --arg s "${OOR_AUTH_SCHEMA}" '{d:"", auth:{n:$n, s:$s, o:"I2I"}}' | put_file "${RUN_DIR}/oor-auth-edge.json"
  saidify_file "${RUN_DIR}/oor-auth-edge.json"
  jq -n --arg lei "${LE_LEI}" --arg name "${PERSON_NAME}" --arg role "${PERSON_OOR}" \
    '{LEI:$lei, personLegalName:$name, officialRole:$role}' | put_file "${RUN_DIR}/oor-data.json"
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

  local report
  report="$(jq -n \
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
    '{status:"ok", runDir:$runDir, aids:{geda:$geda,qvi:$qvi,le:$le,oor:$oor,sally:$sally}, credentials:{qvi:$qviCred,le:$leCred,oorAuth:$oorAuthCred,oor:$oorCred}}')"
  printf '%s\n' "${report}" | put_file "${RUN_DIR}/vlei-tufa-sally-report.json"
  printf '%s\n' "${report}"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
