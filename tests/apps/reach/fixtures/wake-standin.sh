#!/usr/bin/env bash
set -Eeuo pipefail

outcome=''
recipient=''
message_id=''
invocation_log=''

while (($# > 0)); do
    case "$1" in
        --outcome) outcome="${2:-}"; shift 2 ;;
        --to) recipient="${2:-}"; shift 2 ;;
        --message-id) message_id="${2:-}"; shift 2 ;;
        --log) invocation_log="${2:-}"; shift 2 ;;
        *) printf 'wake-standin-v1: unsupported argument: %s\n' "$1" >&2; exit 64 ;;
    esac
done

[[ "$recipient" =~ ^[a-z][a-z0-9-]{0,31}\.[a-z0-9][a-z0-9-]{0,63}@[a-z0-9][a-z0-9.-]{0,252}$ ]] ||
    { printf 'wake-standin-v1: invalid recipient\n' >&2; exit 64; }
[[ "$message_id" =~ ^\<[^[:space:]\<\>]+\>$ ]] ||
    { printf 'wake-standin-v1: invalid Message-ID\n' >&2; exit 64; }
[[ -n "$invocation_log" ]] ||
    { printf 'wake-standin-v1: --log is required\n' >&2; exit 64; }

case "$outcome" in
    busy|stale|no-channel|failed)
        ;;
    surprise-v1)
        # Deliberately outside the product's closed set. It proves fail-closed
        # classification without expanding the stand-in's permitted outcomes.
        ;;
    rang|rang-unverified)
        printf 'wake-standin-v1: live recipient evidence is required for %s\n' \
            "$outcome" >&2
        exit 64
        ;;
    *)
        printf 'wake-standin-v1: unsupported outcome: %s\n' "$outcome" >&2
        exit 64
        ;;
esac

printf 'v1\tpid=%s\trecipient=%s\tmessage-id=%s\toutcome=%s\n' \
    "$$" "$recipient" "$message_id" "$outcome" >>"$invocation_log"
printf 'wake-v1 outcome=%s\n' "$outcome"
