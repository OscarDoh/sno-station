#!/usr/bin/env bash
# External Bash DEBUG instrumentation. Never alter the installed executable.
if [[ "${REACH_TRACE_PLANTED_DELAY:-0}" == 1 && "${REACH_TRACE_DELAY_APPLIED:-0}" != 1 ]]; then
  export REACH_TRACE_DELAY_APPLIED=1
  sleep 2
fi
reach_test_boundary() {
  local source="${BASH_SOURCE[1]:-}" line="${BASH_LINENO[0]:-}"
  if [[ "$source" == "$REACH_TRACE_SOURCE" && "$line" == "$REACH_TRACE_LINE" ]]; then
    printf '%s\t%s\t%s\t%s\n' "$EPOCHREALTIME" "$source" "$line" "$BASHPID" >&"$REACH_TRACE_FD"
    kill -STOP "$BASHPID"
  fi
}
set -T
trap reach_test_boundary DEBUG
