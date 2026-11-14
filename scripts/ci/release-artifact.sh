#!/usr/bin/env bash
# Build, pack and smoke the npm artifact of one package release (the artifact job of npm-release.yml).
#
# Usage, from the checkout being released (the tag's content); this script is release tooling and runs
# from the workflow's own commit (`.release-tooling`):
#   release-artifact.sh meta <package>
#       Write npm_name, artifact, title and version to $GITHUB_OUTPUT. When a tag is being released (TAG, or
#       a pushed tag ref), require it to match the package version.
#   release-artifact.sh build <package> [<package>...]
#       Generate the CI build versions, then build and pack each package from the checkout. Writes
#       tarball=<file name> for the first package to $GITHUB_OUTPUT.
#   release-artifact.sh smoke <package> [<stand-in package>...]
#       Smoke the packed tarball of <package>. Its internal dependencies come from npm at the pinned versions;
#       a stand-in package (built by `build` in a dry run, when npm does not have that version yet) is
#       installed beside it instead.
#
# Only the package under release is built: its dependencies are already on npm in a publishing run
# (release-train.ts registry-deps waits for them), so the smoke takes them from there as users will.
# Procedure: docs/versioning/release-versioning.md.
set -euo pipefail

TOOLING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

fail() {
  echo "release-artifact: $*" >&2
  exit 1
}

output() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "$1" >> "${GITHUB_OUTPUT}"; fi
  echo "$1"
}

# npm name of a package id.
npm_name() {
  case "$1" in
    cesr) echo "cesr-ts" ;;
    keri) echo "keri-ts" ;;
    tufa | verifier | hosting | wallet | registrar | observer | multisync) echo "@keri-ts/$1" ;;
    *) fail "unknown package $1" ;;
  esac
}

# The one packed tarball of a built package.
tarball_of() {
  local found=(packages/"$1"/npm/*.tgz)
  [[ -f "${found[0]}" && ${#found[@]} -eq 1 ]] || fail "expected one packed tarball in packages/$1/npm"
  echo "${found[0]}"
}

meta() {
  local package="$1" name version tag
  name="$(npm_name "${package}")"
  version="$(jq -r .version "packages/${package}/package.json")"
  tag="${TAG:-}"
  if [[ -z "${tag}" && "${GITHUB_REF_TYPE:-}" == "tag" ]]; then tag="${GITHUB_REF_NAME}"; fi
  if [[ -n "${tag}" && "${tag#*-v}" != "${version}" ]]; then
    fail "tag ${tag} does not match ${name} ${version}"
  fi
  output "npm_name=${name}"
  output "artifact=${name#@keri-ts/}-npm"
  output "title=${name}"
  output "version=${version}"
}

build() {
  # 1. Stamp the CI build metadata into every generated version module.
  BUILD_METADATA="build.${GITHUB_RUN_NUMBER:-0}.$(git rev-parse HEAD)"
  export BUILD_METADATA
  deno task version:generate:ci

  # 2. Build and pack each package with the same command its own release always used.
  local first=""
  for package in "$@"; do
    npm_name "${package}" >/dev/null
    case "${package}" in
      cesr | keri) (cd "packages/${package}" && deno task build:npm) ;;
      *) (cd "packages/${package}" && deno run -A scripts/build_npm.ts) ;;
    esac
    (cd "packages/${package}/npm" && npm pack --silent >/dev/null)
    if [[ -z "${first}" ]]; then first="$(basename "$(tarball_of "${package}")")"; fi
  done
  output "tarball=${first}"
}

smoke() {
  local package="$1"
  shift
  local tarball stand_ins=()
  tarball="$(tarball_of "${package}")"
  for stand_in in "$@"; do stand_ins+=("$(tarball_of "${stand_in}")"); done
  case "${package}" in
    cesr) bash "${TOOLING_DIR}/scripts/smoke-test-tephra-npm.sh" "${tarball}" ;;
    keri) bash "${TOOLING_DIR}/scripts/smoke-test-keri-npm.sh" "${tarball}" ${stand_ins[@]+"${stand_ins[@]}"} ;;
    tufa) bash "${TOOLING_DIR}/scripts/smoke-test-tufa-npm.sh" "${tarball}" ${stand_ins[@]+"${stand_ins[@]}"} ;;
    *) bash "${TOOLING_DIR}/scripts/smoke-test-package-npm.sh" "${package}" "${tarball}" ${stand_ins[@]+"${stand_ins[@]}"} ;;
  esac
}

command="${1:-}"
shift || true
case "${command}" in
  meta) meta "${1:?package is required}" ;;
  build) [[ $# -gt 0 ]] || fail "build needs at least one package"; build "$@" ;;
  smoke) smoke "${1:?package is required}" "${@:2}" ;;
  *) fail "usage: release-artifact.sh meta|build|smoke <package> [...]" ;;
esac
