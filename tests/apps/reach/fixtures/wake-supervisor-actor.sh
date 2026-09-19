#!/usr/bin/env bash
set -Eeuo pipefail

root="${1:?mailbox root is required}"
address="${2:?supervisor address is required}"
expected="${3:?expected handled count is required}"
output="${4:?handled output path is required}"
mbox="${MBOX_COMMAND:?MBOX_COMMAND is required}"
deadline=$((SECONDS + 30))

: >"$output"
while ((SECONDS < deadline)); do
    mapfile -t actions < <(
        SNO_REACH_SKIP_WAKE_ADOPTION=1 SNO_REACH_ROOT="$root" \
            "$mbox" inbox --as "$address" | cut -f1
    )
    for path in "${actions[@]}"; do
        [[ -f "$path" ]] || continue
        message_id="$(mhdr -h message-id "$path")"
        grep -Fqx -- "$message_id" "$output" 2>/dev/null && continue
        printf '%s\n' "$message_id" >>"$output"
        SNO_REACH_SKIP_WAKE_ADOPTION=1 SNO_REACH_ROOT="$root" \
            "$mbox" dismiss --as "$address" \
            --card "$path" --reason 'handled exhausted wake escalation' \
            >/dev/null
    done
    [[ "$(wc -l <"$output")" -ge "$expected" ]] && exit 0
    sleep 0.05
done

printf 'wake-supervisor-actor: handled %s of %s escalations\n' \
    "$(wc -l <"$output")" "$expected" >&2
exit 1
