#!/usr/bin/env bash
# Only the external terminal inventory/send boundary is substituted.
set -Eeuo pipefail
case "${1:-} ${2:-}" in
  'terminal list')
    if [[ ! -e "$REACH_TEST_COUNTER" ]]; then
      : >"$REACH_TEST_COUNTER"
      SNO_REACH_NOW=1001 "$REACH_TEST_APP/lib/reach-reachability" register --root "$SNO_REACH_ROOT" \
        --as "$REACH_TEST_SEAT" --channel orca --handle term_new --identity-kind orca-tab \
        --identity new-window-tab --pid "$$" --host "$(hostname)" >/dev/null
      printf '%s\n' '{"ok":true,"result":{"terminals":[{"tabId":"old-window-tab","connected":true,"handle":"term_old"}]}}'
    else
      printf '%s\n' '{"ok":true,"result":{"terminals":[{"tabId":"wrong-window-tab","connected":true,"handle":"term_new"},{"tabId":"new-window-tab","connected":true,"handle":"term_current"}]}}'
    fi
    ;;
  'terminal send') printf '%s\n' "$*" >>"$REACH_TEST_TRACE"; printf '%s\n' '{"ok":true,"result":{}}' ;;
  'terminal read') printf '%s\n' '{"ok":true,"result":{"terminal":{"tail":[]}}}' ;;
  'terminal wait') printf '%s\n' '{"ok":true,"result":{"wait":{"satisfied":true}}}' ;;
  *) printf 'unexpected external terminal call: %s\n' "$*" >&2; exit 99 ;;
esac
