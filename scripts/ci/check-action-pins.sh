#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

failed=0
while IFS= read -r action; do
  case "$action" in
    ./* | docker://*) continue ;;
  esac
  ref="${action##*@}"
  if [[ ! "$ref" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'External action is not pinned to a full commit SHA: %s\n' "$action" >&2
    failed=1
  fi
done < <(rg --no-filename --only-matching 'uses:[[:space:]]+[^[:space:]#]+' .github/actions .github/workflows 2>/dev/null | awk '{print $2}')

exit "$failed"
