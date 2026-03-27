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
result_dir="$(dirname "$result_file")"
primary_model="${LAC_MODEL_NAME:-}"
fast_model="${LAC_FAST_MODEL_NAME:-}"
configured_strategy="${LAC_SUGGEST_STRATEGY:-history+model}"

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

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

launch_stage() {
  local order="$1"
  local total="$2"
  local stage_strategy="$3"
  local stage_model="$4"
  local stage_role="$5"
  local line=""
  local notify_status=0
  local stage_file="$result_dir/${seq}.${order}.${total}.tsv"
  local -a command=(
    "$client_bin" suggest
    --socket "$socket_path"
    --session "$session_id"
    --buffer "$buffer"
    --cwd "$cwd"
    --repo-root "$repo_root"
    --branch "$branch"
    --last-exit "$last_exit_code"
    --strategy "$stage_strategy"
  )

  [[ -n "$stage_model" ]] && command+=(--model "$stage_model")

  latest="$(read_latest || true)"
  [[ "$latest" == "$seq" ]] || return 0

  if ! line="$("${command[@]}" </dev/null 2>&1)"; then
    write_snapshot "worker-error:${worker_pid}:${seq}:${order}" "$line"
    return 0
  fi
  write_snapshot "worker-line:${worker_pid}:${seq}:${order}" "$line"

  latest="$(read_latest || true)"
  [[ "$latest" == "$seq" ]] || return 0

  printf '%s\t%s\n' "$line" "$stage_role" > "$stage_file"

  if [[ -n "$notify_pipe" ]]; then
    printf '%s\n' "${seq}:${order}:${total}" > "$notify_pipe" || notify_status=$?
  fi
  write_snapshot "notify-sent:${worker_pid}:${notify_status}:${seq}:${order}" "$line"
}

launch_stage_plan() {
  local -a stage_strategies=()
  local -a stage_models=()
  local -a stage_roles=()
  local normalized_strategy normalized_primary_model normalized_fast_model
  local total=0
  local index=0
  local history_pid=""

  normalized_strategy="$(trim "$configured_strategy")"
  normalized_primary_model="$(trim "$primary_model")"
  normalized_fast_model="$(trim "$fast_model")"

  case "$normalized_strategy" in
    history-then-model)
      if [[ -n "$buffer" ]]; then
        stage_strategies+=("history-only")
        stage_models+=("")
        stage_roles+=("")
      fi
      stage_strategies+=("history+model-always")
      stage_models+=("$normalized_primary_model")
      stage_roles+=("")
      ;;
    history-then-fast-then-model)
      if [[ -n "$buffer" ]]; then
        stage_strategies+=("history-only")
        stage_models+=("")
        stage_roles+=("")
      fi
      if [[ -n "$normalized_fast_model" && "$normalized_fast_model" != "$normalized_primary_model" ]]; then
        stage_strategies+=("history+model-always")
        stage_models+=("$normalized_fast_model")
        stage_roles+=("fast")
      fi
      stage_strategies+=("history+model-always")
      stage_models+=("$normalized_primary_model")
      stage_roles+=("slow")
      ;;
    fast-then-model)
      if [[ -n "$normalized_fast_model" && "$normalized_fast_model" != "$normalized_primary_model" ]]; then
        stage_strategies+=("model-only")
        stage_models+=("$normalized_fast_model")
        stage_roles+=("fast")
      fi
      stage_strategies+=("model-only")
      stage_models+=("$normalized_primary_model")
      stage_roles+=("slow")
      ;;
    *)
      stage_strategies+=("$normalized_strategy")
      stage_models+=("")
      stage_roles+=("")
      ;;
  esac

  total="${#stage_strategies[@]}"
  (( total > 0 )) || return 0

  case "$normalized_strategy" in
    history-then-fast-then-model|fast-then-model)
      if [[ "$normalized_strategy" == "history-then-fast-then-model" ]] && (( total > 0 )) && [[ "${stage_strategies[0]}" == "history-only" ]]; then
        launch_stage \
          "1" \
          "$total" \
          "${stage_strategies[0]}" \
          "${stage_models[0]}" \
          "${stage_roles[0]}" &
        history_pid="$!"
        index=1
      fi

      for (( ; index < total; index += 1 )); do
        launch_stage \
          "$(( index + 1 ))" \
          "$total" \
          "${stage_strategies[$index]}" \
          "${stage_models[$index]}" \
          "${stage_roles[$index]}"
      done

      if [[ -n "$history_pid" ]]; then
        wait "$history_pid"
      fi
      ;;
    *)
      for index in "${!stage_strategies[@]}"; do
        launch_stage \
          "$(( index + 1 ))" \
          "$total" \
          "${stage_strategies[$index]}" \
          "${stage_models[$index]}" \
          "${stage_roles[$index]}" &
      done

      wait
      ;;
  esac
}

launch_stage_plan
