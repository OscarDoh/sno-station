#!/usr/bin/env bash
# Isolated SSH boundary: exact argv, actual fixed POSIX receiver, real pipes/files.
# This proves neither a physical network nor remote ENOSPC behavior.
set -Eeuo pipefail
expected=(-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=yes -o ForwardAgent=no)
[[ "$#" == 10 ]] || exit 99
for value in "${expected[@]}"; do [[ "$1" == "$value" ]] || exit 99; shift; done
[[ "$1" == reach-isolated-host ]] || exit 99
literal="$2"
[[ "$literal" == *'SNO-REACH-REMOTE/1'* && "$literal" != *"$REACH_SSH_ROOT"* ]] || exit 99
printf '%s' "$literal" >"$REACH_SSH_LOG/receiver"
printf '%s\n' "$1" >>"$REACH_SSH_LOG/hosts"
tee "$REACH_SSH_LOG/wire.$BASHPID" | /bin/sh -c "$literal"
