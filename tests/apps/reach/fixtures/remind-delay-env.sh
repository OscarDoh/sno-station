#!/usr/bin/env bash
# Test-only delays at real public validation and state-query entry points.
# shellcheck disable=SC2154
REACH_DEADLINE_VERB="${1:-}"
REACH_DEADLINE_DELAYED=no
set -T
trap 'if [[ "$REACH_DEADLINE_DELAYED" == no ]]; then
  if [[ "$REACH_DEADLINE_VERB" == remind && "$BASH_COMMAND" == '\''parse_as_only "$@"'\'' ]]; then
    REACH_DEADLINE_DELAYED=yes
    printf "validation %s\n" "$BASHPID" >>"$REACH_DEADLINE_TRACE"
    sleep 2
  elif [[ "$REACH_DEADLINE_VERB" == state && "$BASH_COMMAND" == '\''progress_load "$root" "$journey"'\'' ]]; then
    REACH_DEADLINE_DELAYED=yes
    printf "state %s\n" "$BASHPID" >>"$REACH_DEADLINE_TRACE"
    sleep 2
  fi
fi' DEBUG
