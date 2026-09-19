#!/usr/bin/env bash
set -euo pipefail
if [[ ${1:-} == send-keys ]]; then
    printf '%s\t' "$(date +%s.%N)" >>"$REACH_TMUX_TIMING"
    printf '%q ' "$@" >>"$REACH_TMUX_TIMING"
    printf '\n' >>"$REACH_TMUX_TIMING"
fi
exec "$REACH_REAL_TMUX" -L "$REACH_TEST_SOCKET" "$@"
