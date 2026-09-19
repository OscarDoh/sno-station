# shellcheck shell=bash
# Signal the actual polling sleep, after its first filesystem scan completed.
sleep() {
    printf 'polling\n' >"$REACH_POLL_READY"
    command sleep "$@"
}
