# shellcheck shell=zsh

if [[ -n "${LAC_PLUGIN_LOADED:-}" ]]; then
  return 0
fi
typeset -g LAC_PLUGIN_LOADED=1

autoload -Uz add-zsh-hook
zmodload zsh/datetime 2>/dev/null || true

typeset -g LAC_PLUGIN_PATH="${${(%):-%x}:A}"
typeset -g LAC_ROOT_DIR="${LAC_PLUGIN_PATH:h:h}"
typeset -g LAC_STATE_DIR="${LAC_STATE_DIR:-$HOME/Library/Application Support/cli-auto-complete}"
typeset -g LAC_RUNTIME_ENV_PATH="$LAC_STATE_DIR/runtime.env"
typeset -g LAC_ASYNC_DIR="${LAC_ASYNC_DIR:-$LAC_STATE_DIR/async}"
typeset -g LAC_CLIENT_BIN="${LAC_CLIENT_BIN:-$LAC_ROOT_DIR/bin/autocomplete-client}"
typeset -g LAC_DAEMON_BIN="${LAC_DAEMON_BIN:-$LAC_ROOT_DIR/bin/autocomplete-daemon}"
typeset -g LAC_DAEMON_PID_PATH="$LAC_STATE_DIR/daemon.pid"
typeset -g LAC_DEBOUNCE_SECONDS="${LAC_DEBOUNCE_SECONDS:-0.08}"
typeset -g LAC_HIGHLIGHT_STYLE="${LAC_HIGHLIGHT_STYLE:-fg=242}"
typeset -gi LAC_CAPTURE_BYTES="${LAC_CAPTURE_BYTES:-600}"
typeset -g LAC_MODEL_BASE_URL="${LAC_MODEL_BASE_URL:-}"
typeset -g LAC_SUGGEST_STRATEGY="${LAC_SUGGEST_STRATEGY:-}"
typeset -g LAC_SUGGEST_TIMEOUT_MS="${LAC_SUGGEST_TIMEOUT_MS:-}"

_lac_runtime_value() {
  local key="$1"
  [[ -f "$LAC_RUNTIME_ENV_PATH" ]] || return 0
  (
    source "$LAC_RUNTIME_ENV_PATH" 2>/dev/null || exit 0
    eval "print -r -- \${$key-}"
  ) 2>/dev/null
}

typeset -gx LAC_SOCKET_PATH="${LAC_SOCKET_PATH:-$(_lac_runtime_value LAC_SOCKET_PATH)}"
typeset -gx LAC_DB_PATH="${LAC_DB_PATH:-$(_lac_runtime_value LAC_DB_PATH)}"
typeset -gx LAC_MODEL_NAME="${LAC_MODEL_NAME:-$(_lac_runtime_value LAC_MODEL_NAME)}"
typeset -gx LAC_MODEL_BASE_URL="${LAC_MODEL_BASE_URL:-$(_lac_runtime_value LAC_MODEL_BASE_URL)}"
typeset -gx LAC_SUGGEST_STRATEGY="${LAC_SUGGEST_STRATEGY:-$(_lac_runtime_value LAC_SUGGEST_STRATEGY)}"
typeset -gx LAC_SUGGEST_TIMEOUT_MS="${LAC_SUGGEST_TIMEOUT_MS:-$(_lac_runtime_value LAC_SUGGEST_TIMEOUT_MS)}"
typeset -gx LAC_STATE_DIR

typeset -gx LAC_SOCKET_PATH="${LAC_SOCKET_PATH:-$LAC_STATE_DIR/daemon.sock}"
typeset -gx LAC_DB_PATH="${LAC_DB_PATH:-$LAC_STATE_DIR/autocomplete.sqlite}"
typeset -gx LAC_MODEL_NAME="${LAC_MODEL_NAME:-qwen2.5-coder:7b}"
typeset -gx LAC_MODEL_BASE_URL="${LAC_MODEL_BASE_URL:-http://127.0.0.1:11434}"
typeset -gx LAC_SUGGEST_STRATEGY="${LAC_SUGGEST_STRATEGY:-history+model}"
typeset -gx LAC_SUGGEST_TIMEOUT_MS="${LAC_SUGGEST_TIMEOUT_MS:-1200}"

mkdir -p -- "$LAC_STATE_DIR" "$LAC_ASYNC_DIR"

typeset -g LAC_SESSION_ID="${LAC_SESSION_ID:-lac-$$-${EPOCHSECONDS}-${RANDOM}}"
typeset -g LAC_SUGGESTION=""
typeset -g LAC_SUGGESTION_SOURCE=""
typeset -gi LAC_SUGGESTION_ID=0
typeset -gi LAC_REQUEST_SEQ=0
typeset -gi LAC_ASYNC_READY=0
typeset -gi LAC_LAST_EXIT_CODE=0
typeset -g LAC_ACTIVE_COMMAND=""
typeset -g LAC_COMMAND_CWD=""
typeset -g LAC_COMMAND_REPO_ROOT=""
typeset -g LAC_COMMAND_BRANCH=""
typeset -gi LAC_COMMAND_STARTED_AT_MS=0
typeset -g LAC_CAPTURED_STDOUT=""
typeset -g LAC_CAPTURED_STDERR=""

_lac_now_ms() {
  printf '%d\n' "$(( EPOCHREALTIME * 1000 ))"
}

_lac_repo_root() {
  git rev-parse --show-toplevel 2>/dev/null
}

_lac_git_branch() {
  git symbolic-ref --quiet --short HEAD 2>/dev/null
}

_lac_trim_capture() {
  local text="$1"
  if (( ${#text} <= LAC_CAPTURE_BYTES )); then
    print -rn -- "$text"
    return 0
  fi
  print -rn -- "${text[1,LAC_CAPTURE_BYTES]}"
}

_lac_clear_suggestion() {
  typeset -g LAC_SUGGESTION=""
  typeset -g LAC_SUGGESTION_SOURCE=""
  typeset -gi LAC_SUGGESTION_ID=0
  POSTDISPLAY=""
  _lac_clear_highlight
}

_lac_clear_highlight() {
  local entry
  local -a filtered=()

  for entry in "${region_highlight[@]}"; do
    [[ "$entry" == *"memo=lac-suggestion"* ]] || filtered+=("$entry")
  done

  region_highlight=("${filtered[@]}")
}

_lac_render_suggestion() {
  if [[ -z "$LAC_SUGGESTION" ]]; then
    POSTDISPLAY=""
    _lac_clear_highlight
    return 0
  fi

  if [[ "$BUFFER" == "$LAC_SUGGESTION" ]]; then
    POSTDISPLAY=""
    _lac_clear_highlight
    return 0
  fi

  if [[ "$LAC_SUGGESTION" != "$BUFFER"* ]]; then
    _lac_clear_suggestion
    return 0
  fi

  if (( CURSOR != ${#BUFFER} )); then
    POSTDISPLAY=""
    _lac_clear_highlight
    return 0
  fi

  POSTDISPLAY="${LAC_SUGGESTION#$BUFFER}"
  _lac_clear_highlight

  if [[ -n "$POSTDISPLAY" ]]; then
    local highlight_start=${#BUFFER}
    local highlight_end=$(( ${#BUFFER} + ${#POSTDISPLAY} ))
    region_highlight+=("${highlight_start} ${highlight_end} ${LAC_HIGHLIGHT_STYLE} memo=lac-suggestion")
  fi
}

_lac_write_latest_seq() {
  print -rn -- "$LAC_REQUEST_SEQ" >| "$LAC_ASYNC_DIR/latest.seq"
}

_lac_invalidate_pending() {
  (( LAC_REQUEST_SEQ += 1 ))
  _lac_write_latest_seq
}

_lac_parse_suggestion_line() {
  local line="$1"
  typeset -ga LAC_PARSED_SUGGESTION_FIELDS
  LAC_PARSED_SUGGESTION_FIELDS=(0 "" "")

  if [[ -z "$line" ]]; then
    return 0
  fi

  local suggestion_id suggestion source
  IFS=$'\t' read -r suggestion_id suggestion source <<< "$line"
  LAC_PARSED_SUGGESTION_FIELDS=("$suggestion_id" "$suggestion" "$source")
}

_lac_request_suggestion() {
  local buffer="$1"
  local cwd="$2"
  local repo_root="$3"
  local branch="$4"

  "$LAC_CLIENT_BIN" suggest \
    --socket "$LAC_SOCKET_PATH" \
    --session "$LAC_SESSION_ID" \
    --buffer "$buffer" \
    --cwd "$cwd" \
    --repo-root "$repo_root" \
    --branch "$branch" \
    --last-exit "$LAC_LAST_EXIT_CODE" 2>/dev/null
}

_lac_refresh_suggestion_sync() {
  local repo_root branch line suggestion_id suggestion source

  if [[ -z "$BUFFER" || $CURSOR -ne ${#BUFFER} ]]; then
    _lac_clear_suggestion
    return 0
  fi

  repo_root="$(_lac_repo_root)"
  branch="$(_lac_git_branch)"
  line="$(_lac_request_suggestion "$BUFFER" "$PWD" "$repo_root" "$branch")"
  _lac_parse_suggestion_line "$line"
  suggestion_id="$LAC_PARSED_SUGGESTION_FIELDS[1]"
  suggestion="$LAC_PARSED_SUGGESTION_FIELDS[2]"
  source="$LAC_PARSED_SUGGESTION_FIELDS[3]"

  if [[ -z "$suggestion" || "$suggestion" != "$BUFFER"* || "$suggestion" == "$BUFFER" ]]; then
    _lac_clear_suggestion
    return 0
  fi

  typeset -gi LAC_SUGGESTION_ID="$suggestion_id"
  typeset -g LAC_SUGGESTION="$suggestion"
  typeset -g LAC_SUGGESTION_SOURCE="$source"
  _lac_render_suggestion
}

_lac_apply_async_result() {
  local file seq line suggestion_id suggestion source
  local files=("$LAC_ASYNC_DIR"/*.tsv(N))

  for file in $files; do
    seq="${${file:t}%.tsv}"
    if [[ "$seq" != <-> ]]; then
      rm -f -- "$file"
      continue
    fi
    if (( seq < LAC_REQUEST_SEQ )); then
      rm -f -- "$file"
    fi
  done

  file="$LAC_ASYNC_DIR/$LAC_REQUEST_SEQ.tsv"
  [[ -f "$file" ]] || return 0

  IFS= read -r line < "$file"
  rm -f -- "$file"
  _lac_parse_suggestion_line "$line"
  suggestion_id="$LAC_PARSED_SUGGESTION_FIELDS[1]"
  suggestion="$LAC_PARSED_SUGGESTION_FIELDS[2]"
  source="$LAC_PARSED_SUGGESTION_FIELDS[3]"

  if [[ -z "$suggestion" || "$suggestion" == "$BUFFER" || "$suggestion" != "$BUFFER"* ]]; then
    _lac_clear_suggestion
    return 0
  fi

  if (( CURSOR != ${#BUFFER} )); then
    return 0
  fi

  typeset -gi LAC_SUGGESTION_ID="$suggestion_id"
  typeset -g LAC_SUGGESTION="$suggestion"
  typeset -g LAC_SUGGESTION_SOURCE="$source"
  _lac_render_suggestion
}

_lac_schedule_suggestion() {
  local buffer cwd repo_root branch seq latest_file result_file shell_pid

  if [[ -z "$BUFFER" || $CURSOR -ne ${#BUFFER} ]]; then
    _lac_invalidate_pending
    _lac_clear_suggestion
    return 0
  fi

  buffer="$BUFFER"
  cwd="$PWD"
  repo_root="$(_lac_repo_root)"
  branch="$(_lac_git_branch)"
  (( LAC_REQUEST_SEQ += 1 ))
  seq=$LAC_REQUEST_SEQ
  latest_file="$LAC_ASYNC_DIR/latest.seq"
  result_file="$LAC_ASYNC_DIR/$seq.tsv"
  shell_pid=$$

  _lac_write_latest_seq

  if [[ -n "$LAC_SUGGESTION" && "$LAC_SUGGESTION" != "$BUFFER"* ]]; then
    _lac_clear_suggestion
  else
    _lac_render_suggestion
  fi

  (
    local latest line
    sleep "$LAC_DEBOUNCE_SECONDS"
    if [[ -f "$latest_file" ]]; then
      IFS= read -r latest < "$latest_file"
    fi
    [[ "$latest" == "$seq" ]] || exit 0

    line="$("$LAC_CLIENT_BIN" suggest \
      --socket "$LAC_SOCKET_PATH" \
      --session "$LAC_SESSION_ID" \
      --buffer "$buffer" \
      --cwd "$cwd" \
      --repo-root "$repo_root" \
      --branch "$branch" \
      --last-exit "$LAC_LAST_EXIT_CODE" 2>/dev/null)"

    if [[ -f "$latest_file" ]]; then
      IFS= read -r latest < "$latest_file"
    fi
    [[ "$latest" == "$seq" ]] || exit 0

    print -r -- "$line" >| "$result_file"
    kill -USR1 "$shell_pid" 2>/dev/null || true
  ) &!
}

TRAPUSR1() {
  typeset -gi LAC_ASYNC_READY=1
  if [[ -n "${ZLE_STATE:-}" ]]; then
    zle -R 2>/dev/null
  fi
  return 0
}

_lac_zle_line_pre_redraw() {
  if (( LAC_ASYNC_READY )); then
    typeset -gi LAC_ASYNC_READY=0
    _lac_apply_async_result
  fi
  _lac_render_suggestion
}

_lac_after_buffer_change() {
  if (( LAC_ASYNC_READY )); then
    typeset -gi LAC_ASYNC_READY=0
    _lac_apply_async_result
  fi

  if [[ -z "$BUFFER" || $CURSOR -ne ${#BUFFER} ]]; then
    _lac_invalidate_pending
    _lac_clear_suggestion
    return 0
  fi

  if [[ -n "$LAC_SUGGESTION" && "$LAC_SUGGESTION" == "$BUFFER"* ]]; then
    _lac_render_suggestion
  else
    _lac_clear_suggestion
  fi

  _lac_schedule_suggestion
}

_lac_feedback() {
  local event_type="$1"
  local accepted_command="${2:-}"
  local actual_command="${3:-}"

  (( LAC_SUGGESTION_ID > 0 )) || return 0
  [[ -x "$LAC_CLIENT_BIN" ]] || return 0

  "$LAC_CLIENT_BIN" feedback \
    --socket "$LAC_SOCKET_PATH" \
    --session "$LAC_SESSION_ID" \
    --suggestion-id "$LAC_SUGGESTION_ID" \
    --event "$event_type" \
    --buffer "$BUFFER" \
    --suggestion "$LAC_SUGGESTION" \
    --accepted-command "$accepted_command" \
    --actual-command "$actual_command" >/dev/null 2>&1 &!
}

_lac_record_command() {
  local command="$1"
  local cwd="$2"
  local repo_root="$3"
  local branch="$4"
  local exit_code="$5"
  local duration_ms="$6"
  local started_at_ms="$7"
  local finished_at_ms="$8"
  local stdout_excerpt="$9"
  local stderr_excerpt="${10}"

  [[ -x "$LAC_CLIENT_BIN" ]] || return 0

  "$LAC_CLIENT_BIN" record-command \
    --socket "$LAC_SOCKET_PATH" \
    --session "$LAC_SESSION_ID" \
    --command "$command" \
    --cwd "$cwd" \
    --repo-root "$repo_root" \
    --branch "$branch" \
    --exit-code "$exit_code" \
    --duration-ms "$duration_ms" \
    --started-at-ms "$started_at_ms" \
    --finished-at-ms "$finished_at_ms" \
    --stdout "$stdout_excerpt" \
    --stderr "$stderr_excerpt" >/dev/null 2>&1 &!
}

_lac_preexec() {
  local raw_command="$1"
  local command="$raw_command"

  if (( LAC_SUGGESTION_ID > 0 )) && [[ -n "$LAC_SUGGESTION" ]] && [[ "$command" != "$LAC_SUGGESTION" ]]; then
    _lac_feedback "rejected" "" "$command"
  fi

  _lac_invalidate_pending
  _lac_clear_suggestion

  if [[ "$command" == lac-capture\ * ]]; then
    command="${command#lac-capture }"
  fi

  typeset -g LAC_ACTIVE_COMMAND="$command"
  typeset -g LAC_COMMAND_CWD="$PWD"
  typeset -g LAC_COMMAND_REPO_ROOT="$(_lac_repo_root)"
  typeset -g LAC_COMMAND_BRANCH="$(_lac_git_branch)"
  typeset -gi LAC_COMMAND_STARTED_AT_MS="$(_lac_now_ms)"
  typeset -g LAC_CAPTURED_STDOUT=""
  typeset -g LAC_CAPTURED_STDERR=""
}

_lac_precmd() {
  local exit_code="$?"
  local finished_at_ms duration_ms stdout_excerpt stderr_excerpt

  if [[ -n "$LAC_ACTIVE_COMMAND" ]]; then
    finished_at_ms="$(_lac_now_ms)"
    duration_ms=$(( finished_at_ms - LAC_COMMAND_STARTED_AT_MS ))
    stdout_excerpt="$LAC_CAPTURED_STDOUT"
    stderr_excerpt="$LAC_CAPTURED_STDERR"

    _lac_record_command \
      "$LAC_ACTIVE_COMMAND" \
      "$LAC_COMMAND_CWD" \
      "$LAC_COMMAND_REPO_ROOT" \
      "$LAC_COMMAND_BRANCH" \
      "$exit_code" \
      "$duration_ms" \
      "$LAC_COMMAND_STARTED_AT_MS" \
      "$finished_at_ms" \
      "$stdout_excerpt" \
      "$stderr_excerpt"
  fi

  typeset -g LAC_ACTIVE_COMMAND=""
  typeset -g LAC_CAPTURED_STDOUT=""
  typeset -g LAC_CAPTURED_STDERR=""
  typeset -gi LAC_LAST_EXIT_CODE="$exit_code"
}

lac-start-daemon() {
  local _ attempt daemon_pid

  mkdir -p -- "$LAC_STATE_DIR" "$LAC_ASYNC_DIR"
  [[ -x "$LAC_CLIENT_BIN" && -x "$LAC_DAEMON_BIN" ]] || return 1

  if "$LAC_CLIENT_BIN" health --socket "$LAC_SOCKET_PATH" >/dev/null 2>&1; then
    return 0
  fi

  "$LAC_DAEMON_BIN" \
    --socket "$LAC_SOCKET_PATH" \
    --db "$LAC_DB_PATH" \
    --model "$LAC_MODEL_NAME" \
    --strategy "$LAC_SUGGEST_STRATEGY" >"$LAC_STATE_DIR/daemon.log" 2>&1 &!
  daemon_pid=$!
  print -rn -- "$daemon_pid" >| "$LAC_DAEMON_PID_PATH"

  for attempt in {1..20}; do
    if "$LAC_CLIENT_BIN" health --socket "$LAC_SOCKET_PATH" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done

  return 1
}

lac-capture() {
  local stdout_file stderr_file cmd_status stdout_text stderr_text

  stdout_file="$(mktemp "$LAC_ASYNC_DIR/capture.stdout.XXXXXX")"
  stderr_file="$(mktemp "$LAC_ASYNC_DIR/capture.stderr.XXXXXX")"

  "$@" >"$stdout_file" 2>"$stderr_file"
  cmd_status=$?

  stdout_text="$(<"$stdout_file")"
  stderr_text="$(<"$stderr_file")"

  [[ -n "$stdout_text" ]] && print -rn -- "$stdout_text"
  [[ -n "$stderr_text" ]] && print -rn -- "$stderr_text" >&2

  typeset -g LAC_CAPTURED_STDOUT="$(_lac_trim_capture "$stdout_text")"
  typeset -g LAC_CAPTURED_STDERR="$(_lac_trim_capture "$stderr_text")"

  rm -f -- "$stdout_file" "$stderr_file"
  return "$cmd_status"
}

lac-accept-or-complete() {
  if [[ -n "$LAC_SUGGESTION" && "$LAC_SUGGESTION" == "$BUFFER"* && $CURSOR -eq ${#BUFFER} ]]; then
    local accepted_command="$LAC_SUGGESTION"
    BUFFER="$accepted_command"
    CURSOR=${#BUFFER}
    _lac_feedback "accepted" "$accepted_command" ""
    _lac_clear_suggestion
    zle redisplay
    return 0
  fi

  zle expand-or-complete
}

_lac_wrap_widget() {
  local widget="$1"
  local safe_name="${widget//-/_}"
  local original_widget="_lac_orig_${safe_name}"
  local wrapper_function="_lac_wrap_${safe_name}"

  zle -A "$widget" "$original_widget" 2>/dev/null || return 0

  eval "
function $wrapper_function() {
  zle $original_widget -- \"\$@\"
  local rc=\$?
  _lac_after_buffer_change
  return \$rc
}
"

  zle -N "$widget" "$wrapper_function"
}

zle -N lac-accept-or-complete
zle -N zle-line-pre-redraw _lac_zle_line_pre_redraw

for widget in \
  self-insert \
  backward-delete-char \
  delete-char \
  kill-word \
  backward-kill-word \
  backward-delete-word \
  vi-backward-kill-word \
  backward-kill-line \
  kill-line \
  yank \
  yank-pop \
  transpose-chars \
  transpose-words \
  up-line-or-history \
  down-line-or-history \
  beginning-of-line \
  end-of-line \
  vi-beginning-of-line \
  vi-end-of-line \
  bracketed-paste; do
  _lac_wrap_widget "$widget"
done

bindkey '^I' lac-accept-or-complete

add-zsh-hook preexec _lac_preexec
add-zsh-hook precmd _lac_precmd
