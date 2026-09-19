#!/usr/bin/env bash
printf 'FAIL startup trace crossed a live-runtime boundary: %s\n' "$0" >&2
exit 99
