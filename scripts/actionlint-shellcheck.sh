#!/usr/bin/env bash
set -euo pipefail

shell_source="$(mktemp)"
trap 'rm -f "$shell_source"' EXIT
cat > "$shell_source"

shellcheck_args=("$@")
last_index=$((${#shellcheck_args[@]} - 1))
if test "${shellcheck_args[$last_index]}" = "-"; then
  unset 'shellcheck_args[$last_index]'
fi

flock --exclusive /tmp/orbitpm-bpmn-tool-actionlint-shellcheck.lock \
  shellcheck "${shellcheck_args[@]}" "$shell_source"
