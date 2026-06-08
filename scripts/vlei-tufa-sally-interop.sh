#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="$(cd "${ROOT_DIR}/../../.." && pwd)"
KERIPY_INTEROP_REPO="${KERIPY_INTEROP_REPO:-https://github.com/kentbull/keripy.git}"
KERIPY_INTEROP_COMMIT="${KERIPY_INTEROP_COMMIT:-98b88cf73a746813a8719f05264400467a474c05}"
KERIPY_INTEROP_INSTALL="git+${KERIPY_INTEROP_REPO}@${KERIPY_INTEROP_COMMIT}"
KERIPY_INTEROP_CACHE_ROOT="${KERIPY_INTEROP_CACHE_ROOT:-${XDG_CACHE_HOME:-${HOME}/.cache}/tufa-interop/keripy/${KERIPY_INTEROP_COMMIT}}"
KERIPY_INTEROP_VENV="${KERIPY_INTEROP_VENV:-${KERIPY_INTEROP_CACHE_ROOT}/venv}"
KLI_CMD="${KLI_CMD:-}"

RUN_ID="${RUN_ID:-vlei-tufa-sally-$(date +%Y%m%d%H%M%S)-$RANDOM}"
RUN_DIR="${RUN_DIR:-${TMPDIR:-/tmp}/${RUN_ID}}"
LOG_DIR="${RUN_DIR}/logs"
TUFA_HEAD="${RUN_DIR}/tufa"
KLI_CONFIG_DIR="${RUN_DIR}/keripy-config"
TUFA_NPM_PREFIX="${TUFA_NPM_PREFIX:-${RUN_DIR}/npm-prefix}"
TUFA_INSTALL_MODE="${TUFA_INSTALL_MODE:-tarball}"
TUFA_BIN="${TUFA_BIN:-}"
CESR_TARBALL_PATH="${CESR_TARBALL_PATH:-}"
KERI_TARBALL_PATH="${KERI_TARBALL_PATH:-}"
TUFA_TARBALL_PATH="${TUFA_TARBALL_PATH:-}"
KERI_BASE="${KERI_BASE:-${RUN_ID}}"
KEEP_RUN_DIR="${KEEP_RUN_DIR:-true}"
SALLY_VLEI_IMAGE="${SALLY_VLEI_IMAGE:-gleif/vlei:1.0.3}"
SALLY_IMAGE="${SALLY_IMAGE:-gleif/sally:0.9.0}"
SALLY_BASE_IMAGE="${SALLY_BASE_IMAGE:-gleif/sally:0.9.0}"
SALLY_BUILD_LOCAL="${SALLY_BUILD_LOCAL:-false}"
SALLY_LOGLEVEL="${SALLY_LOGLEVEL:-DEBUG}"
SALLY_COUNTER_PROFILE="${SALLY_COUNTER_PROFILE:-legacy}"
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
MATERIALIZED_VLEI_SCHEMA_DIR="${VLEI_SCHEMA_DIR}"
MATERIALIZED_VLEI_RULES_DIR="${VLEI_RULES_DIR}"

TUFACMD=()

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
RESERVED_DOCKER_PORTS=()
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

can_run_command() {
  "$@" >/dev/null 2>&1
}

download_file() {
  local url="$1"
  local target="$2"
  [[ -f "${target}" ]] && return 0
  mkdir -p "$(dirname "${target}")"
  log "download ${url} -> ${target}"
  curl -fsSL "${url}" -o "${target}"
}

prepare_vlei_fixtures() {
  if [[ -n "${VLEI_SCHEMA_DIR}" ]]; then
    MATERIALIZED_VLEI_SCHEMA_DIR="${VLEI_SCHEMA_DIR}"
    log "using override vLEI schema dir: ${MATERIALIZED_VLEI_SCHEMA_DIR}"
  else
    MATERIALIZED_VLEI_SCHEMA_DIR="${RUN_DIR}/vlei/schema"
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
    MATERIALIZED_VLEI_RULES_DIR="${VLEI_RULES_DIR}"
    log "using override vLEI rules dir: ${MATERIALIZED_VLEI_RULES_DIR}"
  else
    MATERIALIZED_VLEI_RULES_DIR="${RUN_DIR}/vlei/rules"
    log "materializing vLEI rules from ${VLEI_RULES_REPO}@${VLEI_RULES_COMMIT}"
    download_file "${VLEI_RULES_RAW_BASE}/scripts/data/rules.json" \
      "${MATERIALIZED_VLEI_RULES_DIR}/rules.json"
    download_file "${VLEI_RULES_RAW_BASE}/tests/schema/rules/oor-rules.json" \
      "${MATERIALIZED_VLEI_RULES_DIR}/oor-rules.json"
  fi
}

python_supports_314() {
  local python="$1"
  local version major minor
  if ! version="$("${python}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null)"; then
    return 1
  fi
  major="${version%%.*}"
  minor="${version#*.}"
  [[ "${major}" =~ ^[0-9]+$ && "${minor}" =~ ^[0-9]+$ ]] || return 1
  (( major > 3 || (major == 3 && minor >= 14) ))
}

resolve_python314() {
  local candidates=()
  local pyenv_python candidate
  [[ -z "${KERIPY_INTEROP_PYTHON:-}" ]] || candidates+=("${KERIPY_INTEROP_PYTHON}")
  if can_run_command pyenv which python; then
    pyenv_python="$(pyenv which python)"
    [[ -z "${pyenv_python}" ]] || candidates+=("${pyenv_python}")
  fi
  candidates+=(python3.14 python3)
  for candidate in "${candidates[@]}"; do
    if python_supports_314 "${candidate}"; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  fail "KERIpy interop requires Python >= 3.14. Tried: ${candidates[*]}"
}

can_use_kli() {
  local kli="$1"
  [[ -x "${kli}" ]] || return 1
  "${kli}" --help >/dev/null 2>&1
}

prepare_pinned_keripy() {
  if [[ -n "${KLI_CMD}" ]]; then
    can_use_kli "${KLI_CMD}" || fail "KLI_CMD is not executable/runnable: ${KLI_CMD}"
    log "using override KLI command: ${KLI_CMD}"
    return 0
  fi

  if [[ -n "${KERIPY_DIR:-}" ]]; then
    KLI_CMD="${KERIPY_DIR}/venv/bin/kli"
    can_use_kli "${KLI_CMD}" || fail "KERIPY_DIR did not provide runnable KLI: ${KLI_CMD}"
    log "using override KERIpy dir: ${KERIPY_DIR}"
    return 0
  fi

  local marker="${KERIPY_INTEROP_CACHE_ROOT}/PIN"
  local kli="${KERIPY_INTEROP_VENV}/bin/kli"
  if [[ -f "${marker}" ]] && [[ "$(tr -d '\r\n' <"${marker}")" == "${KERIPY_INTEROP_COMMIT}" ]] && can_use_kli "${kli}"; then
    KLI_CMD="${kli}"
    log "using cached pinned KERIpy ${KERIPY_INTEROP_COMMIT}: ${KLI_CMD}"
    return 0
  fi

  local python
  python="$(resolve_python314)"
  rm -rf "${KERIPY_INTEROP_VENV}"
  mkdir -p "${KERIPY_INTEROP_CACHE_ROOT}"
  log "creating pinned KERIpy venv with ${python}: ${KERIPY_INTEROP_REPO}@${KERIPY_INTEROP_COMMIT}"
  run "${python}" -m venv "${KERIPY_INTEROP_VENV}"
  if can_run_command uv --version; then
    run uv pip install --python "${KERIPY_INTEROP_VENV}/bin/python" "${KERIPY_INTEROP_INSTALL}"
  else
    run "${KERIPY_INTEROP_VENV}/bin/python" -m pip install --upgrade pip setuptools wheel
    run "${KERIPY_INTEROP_VENV}/bin/python" -m pip install "${KERIPY_INTEROP_INSTALL}"
  fi
  can_use_kli "${kli}" || fail "Pinned KERIpy install did not produce runnable KLI: ${kli}"
  printf '%s\n' "${KERIPY_INTEROP_COMMIT}" >"${marker}"
  KLI_CMD="${kli}"
}

pack_package_tarball() {
  local package_dir="$1"
  local __result_var="$2"
  local tarball
  tarball="$(cd "${package_dir}" && npm pack --silent | tail -n1)"
  printf -v "${__result_var}" '%s/%s' "${package_dir}" "${tarball}"
}

prepare_tufa_command() {
  if [[ -n "${TUFA_BIN}" ]]; then
    [[ -x "${TUFA_BIN}" ]] || fail "TUFA_BIN is not executable: ${TUFA_BIN}"
    TUFACMD=("${TUFA_BIN}")
    log "using override Tufa binary: ${TUFA_BIN}"
    return 0
  fi

  case "${TUFA_INSTALL_MODE}" in
    source)
      TUFACMD=(deno run --allow-all --unstable-ffi "${ROOT_DIR}/packages/tufa/mod.ts")
      log "using source Tufa command: ${TUFACMD[*]}"
      return 0
      ;;
    tarball)
      ;;
    *)
      fail "Unknown TUFA_INSTALL_MODE=${TUFA_INSTALL_MODE}; expected tarball or source"
      ;;
  esac

  require_cmd npm
  require_cmd node
  if [[ -z "${CESR_TARBALL_PATH}" || -z "${KERI_TARBALL_PATH}" || -z "${TUFA_TARBALL_PATH}" ]]; then
    run deno task npm:build:all
  fi
  [[ -n "${CESR_TARBALL_PATH}" ]] || pack_package_tarball "${ROOT_DIR}/packages/cesr/npm" CESR_TARBALL_PATH
  [[ -n "${KERI_TARBALL_PATH}" ]] || pack_package_tarball "${ROOT_DIR}/packages/keri/npm" KERI_TARBALL_PATH
  [[ -n "${TUFA_TARBALL_PATH}" ]] || pack_package_tarball "${ROOT_DIR}/packages/tufa/npm" TUFA_TARBALL_PATH
  [[ -f "${CESR_TARBALL_PATH}" ]] || fail "CESR tarball not found: ${CESR_TARBALL_PATH}"
  [[ -f "${KERI_TARBALL_PATH}" ]] || fail "keri-ts tarball not found: ${KERI_TARBALL_PATH}"
  [[ -f "${TUFA_TARBALL_PATH}" ]] || fail "Tufa tarball not found: ${TUFA_TARBALL_PATH}"

  mkdir -p "${TUFA_NPM_PREFIX}"
  log "installing Tufa tarballs into ${TUFA_NPM_PREFIX}"
  run npm install -g --prefix "${TUFA_NPM_PREFIX}" --force \
    "${CESR_TARBALL_PATH}" \
    "${KERI_TARBALL_PATH}" \
    "${TUFA_TARBALL_PATH}"
  TUFACMD=("${TUFA_NPM_PREFIX}/bin/tufa")
  [[ -x "${TUFACMD[0]}" ]] || fail "Tarball install did not produce executable ${TUFACMD[0]}"
  export PATH="${TUFA_NPM_PREFIX}/bin:${PATH}"
  log "using tarball-installed Tufa command: ${TUFACMD[0]}"
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
  if [[ "${SALLY_BASE_IMAGE}" == w3c-crosswalk/isomer-python* ]]; then
    fail "SALLY_BASE_IMAGE must not use w3c-crosswalk/isomer-python; use a gleif/sally image or another public Sally artifact"
  fi

  if docker_image_exists "${SALLY_IMAGE}"; then
    return 0
  fi

  if [[ "${SALLY_BUILD_LOCAL}" != "true" ]]; then
    run docker pull "${SALLY_IMAGE}"
    return 0
  fi

  if ! docker_image_exists "${SALLY_BASE_IMAGE}"; then
    run docker pull "${SALLY_BASE_IMAGE}"
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

docker_port_is_listed() {
  local port="$1"
  docker ps --format '{{.Ports}}' 2>/dev/null | grep -Eq "(^|[, ])([0-9.]+|\\[::\\]|:::):${port}->"
}

docker_can_publish_port() {
  local port="$1"
  local probe="tufa-port-probe-${RUN_ID##*-}-${port}"
  docker rm -f "${probe}" >/dev/null 2>&1 || true
  if ! docker run -d --rm --name "${probe}" -p "${port}:9" --entrypoint /bin/sh "${SALLY_IMAGE}" -c 'sleep 2' >/dev/null 2>&1; then
    docker rm -f "${probe}" >/dev/null 2>&1 || true
    return 1
  fi
  docker rm -f "${probe}" >/dev/null 2>&1 || true
}

docker_port_is_reserved() {
  local port="$1"
  local reserved
  for reserved in "${RESERVED_DOCKER_PORTS[@]:-}"; do
    [[ "${reserved}" != "${port}" ]] || return 0
  done
  return 1
}

random_docker_port() {
  local port
  for _ in {1..80}; do
    port="$(random_port)"
    if docker_port_is_reserved "${port}" || docker_port_is_listed "${port}"; then
      continue
    fi
    if docker_can_publish_port "${port}"; then
      RESERVED_DOCKER_PORTS+=("${port}")
      printf '%s\n' "${port}"
      return 0
    fi
  done
  fail "could not allocate a Docker-publishable local port"
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

  run tufa multisig incept -n "${store1}" --head-dir "${TUFA_HEAD}" -a "${member1}" -g "${group}" -f "${cfg}" --approval-timeout 1
  run tufa multisig join -n "${store2}" --head-dir "${TUFA_HEAD}" -g "${group}" -Y --poll-turns 80 --poll-budget-ms 2000 --receipt-endpoint
  run tufa multisig join -n "${store1}" --head-dir "${TUFA_HEAD}" -g "${group}" -Y --poll-turns 80 --poll-budget-ms 2000 --receipt-endpoint
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
    tufa multisig incept -n qvi1 --head-dir "${TUFA_HEAD}" -a qvi-m1 -g qvi -f "${cfg}" --proxy qvi-m1 --approval-timeout 120

  qvi2_log="${LOG_DIR}/qvi-delegated-join-qvi2.log"
  start_cmd_bg qvi2_pid qvi-delegated-join-qvi2 "${qvi2_log}" \
    tufa multisig join -n qvi2 --head-dir "${TUFA_HEAD}" -g qvi -Y --poll-turns 120 --poll-budget-ms 2000 --receipt-endpoint --proxy qvi-m2

  run tufa delegate confirm -n geda1 --head-dir "${TUFA_HEAD}" -a geda --interact --auto
  run tufa multisig join -n geda2 --head-dir "${TUFA_HEAD}" -g geda -Y --poll-turns 120 --poll-budget-ms 2000 --receipt-endpoint
  run tufa multisig join -n geda1 --head-dir "${TUFA_HEAD}" -g geda -Y --poll-turns 120 --poll-budget-ms 2000 --receipt-endpoint
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
  run tufa multisig join -n "${store2}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}" -Y --poll-turns 80 --poll-budget-ms 2000 --receipt-endpoint
  run tufa multisig join -n "${store1}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}" -Y --poll-turns 80 --poll-budget-ms 2000 --receipt-endpoint
  run tufa vc registry status -n "${store1}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}"
  run tufa vc registry status -n "${store2}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}"
}

multisig_mailbox_add_round() {
  local store1="$1"
  local store2="$2"
  local group="$3"
  local mailbox_oobi="$4"
  local mailbox_alias="$5"
  resolve_oobi "${store1}" "${mailbox_oobi}" "${mailbox_alias}"
  run tufa mailbox add -n "${store1}" --head-dir "${TUFA_HEAD}" -a "${group}" -w "${mailbox_alias}" --multisig-mode propose
  run tufa multisig join -n "${store2}" --head-dir "${TUFA_HEAD}" -Y --poll-turns 80 --poll-budget-ms 2000
  run tufa multisig join -n "${store1}" --head-dir "${TUFA_HEAD}" -Y --poll-turns 80 --poll-budget-ms 2000
  resolve_oobi "${store1}" "${mailbox_oobi}" "${mailbox_alias}"
  resolve_oobi "${store2}" "${mailbox_oobi}" "${mailbox_alias}"
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
  local output args
  args=(vc create -n "${store1}" --head-dir "${TUFA_HEAD}" -a "${group}" --registry-name "${registry}" --schema "${schema}" --recipient "${recipient}" --data "@${data_file}")
  [[ -n "${edges_file}" ]] && args+=(--edges "@${edges_file}")
  [[ -n "${rules_file}" ]] && args+=(--rules "@${rules_file}")
  capture output tufa "${args[@]}"
  printf '%s\n' "${output}"
  run tufa multisig join -n "${store2}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}" -Y --poll-turns 80 --poll-budget-ms 2000 --receipt-endpoint
  run tufa multisig join -n "${store1}" --head-dir "${TUFA_HEAD}" --registry-name "${registry}" -Y --poll-turns 80 --poll-budget-ms 2000 --receipt-endpoint
  printf -v "${__said_var}" '%s' "$(json_field "${output}" '.said')"
}

poll_saved() {
  local store="$1"
  local alias="$2"
  local said="$3"
  local out
  local i
  for i in $(seq 1 30); do
    capture out tufa ipex poll -n "${store}" --head-dir "${TUFA_HEAD}" -a "${alias}" --poll-turns 8 --poll-budget-ms 2000
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
  run tufa ipex grant -n "${issuer1}" --head-dir "${TUFA_HEAD}" -a "${group}" -r "${recipient}" --said "${said}" --delivery indirect --approval-timeout 0
  run tufa ipex join -n "${issuer2}" --head-dir "${TUFA_HEAD}" --auto --poll-turns 100 --poll-budget-ms 2000
  run tufa ipex join -n "${issuer1}" --head-dir "${TUFA_HEAD}" --auto --poll-turns 100 --poll-budget-ms 2000
}

present_group_to_sally() {
  local holder1="$1"
  local holder2="$2"
  local group="$3"
  local said="$4"
  local expected="$5"
  log "presenting ${expected} ${said} from ${group} to Sally"
  run tufa ipex grant -n "${holder1}" --head-dir "${TUFA_HEAD}" -a "${group}" -r "${SALLY_PRE}" --said "${said}" --delivery direct --approval-timeout 0 --counter-profile "${SALLY_COUNTER_PROFILE}"
  run tufa ipex join -n "${holder2}" --head-dir "${TUFA_HEAD}" --auto --poll-turns 100 --poll-budget-ms 2000 --counter-profile "${SALLY_COUNTER_PROFILE}"
  run tufa ipex join -n "${holder1}" --head-dir "${TUFA_HEAD}" --auto --poll-turns 100 --poll-budget-ms 2000 --delivery direct --counter-profile "${SALLY_COUNTER_PROFILE}"
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

assert_sally_oobi_endpoint_replies() {
  local bytes="${RUN_DIR}/sally-oobi.cesr"
  local annotated="${RUN_DIR}/sally-oobi.annotated"

  log "verifying Sally OOBI includes signed endpoint replies"
  if ! curl -fsS -o "${bytes}" "${SALLY_OOBI}"; then
    capture_docker_logs
    fail "unable to fetch Sally OOBI ${SALLY_OOBI}"
  fi
  if ! "${TUFACMD[@]}" annotate --in "${bytes}" --out "${annotated}" --pretty; then
    capture_docker_logs
    fail "unable to annotate Sally OOBI ${SALLY_OOBI}"
  fi

  if ! grep -Eq '"r"[[:space:]]*:[[:space:]]*"/loc/scheme"' "${annotated}"; then
    sed -n '1,220p' "${annotated}" >&2 || true
    capture_docker_logs
    fail "Sally OOBI ${SALLY_OOBI} is missing /loc/scheme"
  fi
  if ! grep -Eq '"url"[[:space:]]*:[[:space:]]*"http://127\.0\.0\.1:'"${SALLY_PORT}"'/"' "${annotated}"; then
    sed -n '1,220p' "${annotated}" >&2 || true
    capture_docker_logs
    fail "Sally /loc/scheme does not advertise host-reachable curl http://127.0.0.1:${SALLY_PORT}/"
  fi
  if ! grep -Eq '"r"[[:space:]]*:[[:space:]]*"/end/role/add"' "${annotated}"; then
    sed -n '1,220p' "${annotated}" >&2 || true
    capture_docker_logs
    fail "Sally OOBI ${SALLY_OOBI} is missing /end/role/add"
  fi
  if ! grep -Eq '"role"[[:space:]]*:[[:space:]]*"controller"' "${annotated}"; then
    sed -n '1,220p' "${annotated}" >&2 || true
    capture_docker_logs
    fail "Sally /end/role/add does not advertise the controller role"
  fi
}

start_sally_stack() {
  local conf_dir="${RUN_DIR}/sally-conf"
  local conf_cf_dir="${conf_dir}/keri/cf"
  local sally_var="${RUN_DIR}/sally-var"
  mkdir -p "${conf_cf_dir}" "${sally_var}"
  ensure_sally_image
  SALLY_VLEI_PORT="$(random_docker_port)"
  SALLY_HOOK_PORT="$(random_docker_port)"
  SALLY_PORT="$(random_docker_port)"
  log "Sally ports vLEI=${SALLY_VLEI_PORT} hook=${SALLY_HOOK_PORT} server=${SALLY_PORT}"
  local suffix="${RUN_ID##*-}"
  DOCKER_NETWORK="tufa-sally-${suffix}"
  SALLY_VLEI_CONTAINER="tufa-vlei-${suffix}"
  SALLY_HOOK_CONTAINER="tufa-sally-hook-${suffix}"
  SALLY_CONTAINER="tufa-sally-${suffix}"
  DOCKER_CONTAINERS=("${SALLY_CONTAINER}" "${SALLY_HOOK_CONTAINER}" "${SALLY_VLEI_CONTAINER}")

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
sally server start --name "${SALLY_NAME}" --alias "${SALLY_ALIAS}" --passcode "${SALLY_PASSCODE}" --salt "${SALLY_SALT}" --config-dir /sally/conf --config-file "${SALLY_CONFIG_FILE}" --incept-file sally-incept-no-wits.json --web-hook "${WEBHOOK_HOST}" --auth "${GEDA_PRE}" --loglevel "${SALLY_LOGLEVEL}" --direct
SH
  chmod +x "${conf_dir}/entry-point.sh"

  run docker network create "${DOCKER_NETWORK}"
  run docker run -d --rm --name "${SALLY_VLEI_CONTAINER}" --network "${DOCKER_NETWORK}" -p "${SALLY_VLEI_PORT}:7723" \
    "${SALLY_VLEI_IMAGE}" vLEI-server -s /vLEI/schema -c /vLEI/credentials -o /vLEI/oobis
  wait_http "http://127.0.0.1:${SALLY_VLEI_PORT}/oobi/${QVI_SCHEMA}" 120

  run docker run -d --rm --name "${SALLY_HOOK_CONTAINER}" --network "${DOCKER_NETWORK}" -p "${SALLY_HOOK_PORT}:9923" \
    "${SALLY_IMAGE}" sally hook demo
  wait_http "http://127.0.0.1:${SALLY_HOOK_PORT}/health" 120

  run docker run -d --rm --name "${SALLY_CONTAINER}" --network "${DOCKER_NETWORK}" -p "${SALLY_PORT}:9723" \
    -v "${conf_dir}:/sally/conf" \
    -v "${sally_var}:/usr/local/var/keri" \
    -e "SALLY_NAME=${SALLY_NAME}" \
    -e "SALLY_ALIAS=${SALLY_ALIAS}" \
    -e "SALLY_CONFIG_FILE=${SALLY_CONFIG_FILE}" \
    -e "SALLY_SALT=${SALLY_SALT}" \
    -e "SALLY_PASSCODE=${SALLY_PASSCODE}" \
    -e "SALLY_LOGLEVEL=${SALLY_LOGLEVEL}" \
    -e "WEBHOOK_HOST=http://${SALLY_HOOK_CONTAINER}:9923/" \
    -e "GEDA_PRE=${GEDA_PRE}" \
    --entrypoint /bin/bash \
    "${SALLY_IMAGE}" /sally/conf/entry-point.sh
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
  log "Sally delivery counter profile ${SALLY_COUNTER_PROFILE}"
  assert_sally_oobi_endpoint_replies
}

main() {
  require_cmd jq
  require_cmd curl
  require_cmd docker
  require_cmd deno
  mkdir -p "${RUN_DIR}" "${LOG_DIR}" "${TUFA_HEAD}" "${KLI_CONFIG_DIR}/keri/cf"
  log "run dir: ${RUN_DIR}"
  prepare_vlei_fixtures
  prepare_pinned_keripy
  prepare_tufa_command
  log "KERIpy source ${KERIPY_INTEROP_REPO}@${KERIPY_INTEROP_COMMIT}"
  log "KLI command ${KLI_CMD}"
  log "Tufa command ${TUFACMD[*]}"
  log "Sally image ${SALLY_IMAGE}"

  log "starting KERIpy demo witnesses"
  start_bg kli-witness-demo "${LOG_DIR}/kli-witness-demo.log" "${KLI_CMD}" witness demo --base "${KERI_BASE}"
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
