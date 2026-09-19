# shellcheck shell=bash
# macOS supplies TMPDIR with a trailing slash; fixture roots must be canonical.
TMPDIR="$(cd -- "${TMPDIR:-/tmp}" && pwd -P)"
export TMPDIR
test_process_ids() {
    if [[ -d /proc ]]; then
        local path
        for path in /proc/[0-9]*; do printf '%s\n' "${path##*/}"; done
    else ps -axo pid=; fi
}
test_process_command() {
    if [[ -d /proc ]]; then tr '\0' ' ' <"/proc/$1/cmdline";
    else ps -ww -o command= -p "$1"; fi
}
test_process_arguments() {
    if [[ -d /proc ]]; then tr '\0' '\n' <"/proc/$1/cmdline";
    else ps -ww -o command= -p "$1" | awk '{for (i=1; i<=NF; i++) print $i}'; fi
}
