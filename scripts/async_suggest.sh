#!/usr/bin/env bash
set -euo pipefail

debounce_seconds="$1"
latest_file="$2"
seq="$3"
result_file="$4"
client_bin="$5"
socket_path="$6"
session_id="$7"
buffer="$8"
cwd="$9"
repo_root="${10}"
branch="${11}"
last_exit_code="${12}"
notify_pipe="${13}"
snapshot_path="${14:-}"
worker_pid="$$"

snapshot_field() {
  local value="$1"
  value="${value//$'\t'/ }"
  value="${value//$'\n'/ }"
  value="${value//$'\r'/ }"
  printf '%s' "$value"
}

write_snapshot() {
  local event="$1"
  local suggestion_line="${2:-}"

  [[ -n "$snapshot_path" ]] || return 0

  printf '%s\t%s\t\t%s\t\t%s\t0\t%s\n' \
    "$event" \
    "$(snapshot_field "$buffer")" \
    "$(snapshot_field "$suggestion_line")" \
    "${#buffer}" \
    "$seq" >> "$snapshot_path"
}

read_latest() {
  if [[ -f "$latest_file" ]]; then
    cat "$latest_file"
    return 0
  fi
  return 1
}

write_snapshot "worker-start:${worker_pid}:${seq}"

sleep "$debounce_seconds"
latest="$(read_latest || true)"
write_snapshot "worker-awake:${worker_pid}:${latest:-}:${seq}"
[[ "$latest" == "$seq" ]] || exit 0

line=""
if ! line="$($client_bin suggest \
  --socket "$socket_path" \
  --session "$session_id" \
  --buffer "$buffer" \
  --cwd "$cwd" \
  --repo-root "$repo_root" \
  --branch "$branch" \
  --last-exit "$last_exit_code" </dev/null 2>&1)"; then
  write_snapshot "worker-error:${worker_pid}:${seq}" "$line"
  exit 0
fi
write_snapshot "worker-line:${worker_pid}:${seq}" "$line"

latest="$(read_latest || true)"
[[ "$latest" == "$seq" ]] || exit 0

printf '%s\n' "$line" > "$result_file"

notify_status=0
if [[ -n "$notify_pipe" ]]; then
  printf '%s\n' "$seq" > "$notify_pipe" || notify_status=$?
fi
write_snapshot "notify-sent:${worker_pid}:${notify_status}:${seq}" "$line"
