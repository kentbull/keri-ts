#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${1:-origin/master}"

print_remedies() {
  cat <<'EOF'

Resolve this before opening or merging the PR:
  deno task release:changeset
  deno task release:changeset:empty
EOF
}

current_branch() {
  if [[ -n "${GITHUB_HEAD_REF:-}" ]]; then
    printf '%s\n' "${GITHUB_HEAD_REF}"
    return
  fi

  if [[ -n "${GITHUB_REF_NAME:-}" ]]; then
    printf '%s\n' "${GITHUB_REF_NAME}"
    return
  fi

  git branch --show-current 2>/dev/null || true
}

is_changeset_file() {
  local path="$1"
  [[ "${path}" == .changeset/*.md && "${path}" != ".changeset/README.md" ]]
}

has_changed_changeset_file() {
  local status path next_path

  while IFS=$'\t' read -r status path next_path; do
    [[ -z "${path:-}" ]] && continue
    if [[ "${status}" == R* || "${status}" == C* ]]; then
      path="${next_path:-$path}"
    fi
    case "${status}" in
      A*|M*|R*|C*)
        if is_changeset_file "${path}"; then
          return 0
        fi
        ;;
    esac
  done < <(git diff --name-status "${BASE_REF}...HEAD")

  while IFS=$'\t' read -r status path next_path; do
    [[ -z "${path:-}" ]] && continue
    if [[ "${status}" == R* || "${status}" == C* ]]; then
      path="${next_path:-$path}"
    fi
    case "${status}" in
      A*|M*|R*|C*)
        if is_changeset_file "${path}"; then
          return 0
        fi
        ;;
    esac
  done < <(git diff --cached --name-status)

  while IFS=$'\t' read -r status path next_path; do
    [[ -z "${path:-}" ]] && continue
    if [[ "${status}" == R* || "${status}" == C* ]]; then
      path="${next_path:-$path}"
    fi
    case "${status}" in
      A*|M*|R*|C*)
        if is_changeset_file "${path}"; then
          return 0
        fi
        ;;
    esac
  done < <(git diff --name-status)

  while IFS= read -r path; do
    if is_changeset_file "${path}"; then
      return 0
    fi
  done < <(git ls-files --others --exclude-standard .changeset)

  return 1
}

BRANCH="$(current_branch)"
if [[ "${BRANCH}" == changeset-release/* ]]; then
  echo "Skipping changeset check for generated Changesets version branch: ${BRANCH}"
  exit 0
fi

if ! git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null; then
  echo "Changeset check failed: base ref is not available: ${BASE_REF}" >&2
  echo "Fetch the base branch first, for example: git fetch origin master" >&2
  exit 1
fi

echo "Checking Changesets release intent since ${BASE_REF}"
STATUS_FAILED=0
if ! npx --yes @changesets/cli status --since="${BASE_REF}"; then
  STATUS_FAILED=1
fi

if ! has_changed_changeset_file; then
  echo "Changeset check failed: this PR must add or update a non-README .changeset/*.md file." >&2
  print_remedies >&2
  exit 1
fi

if [[ "${STATUS_FAILED}" -ne 0 ]]; then
  echo "Changeset status failed." >&2
  print_remedies >&2
  exit 1
fi

echo "Changeset check passed."
