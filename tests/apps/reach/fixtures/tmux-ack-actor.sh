#!/usr/bin/env bash
# Integration-only actor: read its public inbox and acknowledge; never author replies.
set -Eeuo pipefail
stty -echo
printf 'READY integration ACK actor\n'
while IFS= read -r line; do
  if [[ "$line" == REACH-RING* && "$line" =~ and\ then\ ([0-9a-f]{8}) ]]; then
    nonce="${BASH_REMATCH[1]}"
    root="$(tmux show-options -pqv -t "$TMUX_PANE" @sno_reach_root)"
    address="$(tmux show-options -pqv -t "$TMUX_PANE" @sno_reach_address)"
    [[ -n "$root" && -n "$address" ]] || exit 1
    [[ "$line" =~ Guide:\ ([^[:space:]]+)\.\ State: ]] || exit 1
    guide="${BASH_REMATCH[1]}"
    [[ -r "$guide" ]] || exit 1
    printf '%s\n' "$line"
    release="$(dirname -- "$(dirname -- "$guide")")"
    SNO_REACH_ROOT="$root" "$release/bin/sno-reach" inbox --as "$address" >/dev/null
    printf 'ACK-%s\n' "$nonce"
  fi
done
