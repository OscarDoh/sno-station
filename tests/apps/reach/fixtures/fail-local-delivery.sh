#!/usr/bin/env bash
set -Eeuo pipefail
# Inject the filesystem fault only after real public preflight and durable staging.
: "${REACH_TEST_FAIL_NEW:?}"
while IFS= read -r destination; do rmdir -- "$destination"; done <<<"$REACH_TEST_FAIL_NEW"
exec "$(dirname -- "$0")/reach-deliver.real" "$@"
