# shellcheck shell=zsh

if [[ -n "${LAC_PLUGIN_LOADED:-}" ]]; then
  return 0
fi
typeset -g LAC_PLUGIN_LOADED=1

autoload -Uz add-zsh-hook
zmodload zsh/datetime 2>/dev/null || true

typeset -g LAC_PLUGIN_PATH="${${(%):-%x}:A}"
typeset -g LAC_ROOT_DIR="${LAC_PLUGIN_PATH:h:h}"
typeset -g LAC_STATE_DIR="${LAC_STATE_DIR:-$HOME/Library/Application Support/llm-cli-suggestions}"
typeset -g LAC_RUNTIME_ENV_PATH="$LAC_STATE_DIR/runtime.env"
typeset -g LAC_ASYNC_DIR="${LAC_ASYNC_DIR:-$LAC_STATE_DIR/async}"
typeset -g LAC_CLIENT_BIN="${LAC_CLIENT_BIN:-$LAC_ROOT_DIR/bin/autocomplete-client}"
typeset -g LAC_DAEMON_BIN="${LAC_DAEMON_BIN:-$LAC_ROOT_DIR/bin/autocomplete-daemon}"
typeset -g LAC_ASYNC_HELPER_BIN="${LAC_ASYNC_HELPER_BIN:-$LAC_ROOT_DIR/scripts/async_suggest.sh}"
typeset -g LAC_DAEMON_PID_PATH="$LAC_STATE_DIR/daemon.pid"
typeset -g LAC_DEBOUNCE_SECONDS="${LAC_DEBOUNCE_SECONDS:-0.08}"
typeset -g LAC_HIGHLIGHT_STYLE="${LAC_HIGHLIGHT_STYLE:-fg=242}"
typeset -g LAC_SNAPSHOT_PATH="${LAC_SNAPSHOT_PATH:-}"
typeset -gi LAC_CAPTURE_HEAD_BYTES="${LAC_CAPTURE_HEAD_BYTES:-400}"
typeset -gi LAC_CAPTURE_TAIL_BYTES="${LAC_CAPTURE_TAIL_BYTES:-800}"
typeset -g LAC_AUTO_CAPTURE_ENABLED="${LAC_AUTO_CAPTURE_ENABLED:-0}"
typeset -g LAC_PTY_CAPTURE_MODE="${LAC_PTY_CAPTURE_MODE:-}"
typeset -g LAC_PTY_CAPTURE_ALLOWLIST="${LAC_PTY_CAPTURE_ALLOWLIST:-}"
typeset -g LAC_PTY_CAPTURE_BLOCKLIST="${LAC_PTY_CAPTURE_BLOCKLIST:-}"
typeset -g LAC_MODEL_BASE_URL="${LAC_MODEL_BASE_URL:-}"
typeset -g LAC_SUGGEST_STRATEGY="${LAC_SUGGEST_STRATEGY:-}"
typeset -g LAC_SUGGEST_TIMEOUT_MS="${LAC_SUGGEST_TIMEOUT_MS:-}"
typeset -g LAC_ACCEPT_KEY="${LAC_ACCEPT_KEY:-}"
typeset -g LAC_FAST_MODEL_NAME="${LAC_FAST_MODEL_NAME:-}"

_lac_runtime_value() {
  local key="$1"
  [[ -f "$LAC_RUNTIME_ENV_PATH" ]] || return 0
  (
    source "$LAC_RUNTIME_ENV_PATH" 2>/dev/null || exit 0
    eval "print -r -- \${$key-}"
  ) 2>/dev/null
}

_lac_resolve_setting() {
  local key="$1"
  local current_value="$2"
  local runtime_value=""

  runtime_value="$(_lac_runtime_value "$key")"

  case "${FANCY:-}" in
    1|true|yes|on)
      if [[ -n "$runtime_value" ]]; then
        print -r -- "$runtime_value"
        return 0
      fi
      ;;
  esac

  if [[ -n "$current_value" ]]; then
    print -r -- "$current_value"
    return 0
  fi

  print -r -- "$runtime_value"
}

typeset -gx LAC_SOCKET_PATH="$(_lac_resolve_setting LAC_SOCKET_PATH "$LAC_SOCKET_PATH")"
typeset -gx LAC_DB_PATH="$(_lac_resolve_setting LAC_DB_PATH "$LAC_DB_PATH")"
typeset -gx LAC_MODEL_NAME="$(_lac_resolve_setting LAC_MODEL_NAME "$LAC_MODEL_NAME")"
typeset -gx LAC_FAST_MODEL_NAME="$(_lac_resolve_setting LAC_FAST_MODEL_NAME "$LAC_FAST_MODEL_NAME")"
typeset -gx LAC_MODEL_BASE_URL="$(_lac_resolve_setting LAC_MODEL_BASE_URL "$LAC_MODEL_BASE_URL")"
typeset -gx LAC_SUGGEST_STRATEGY="$(_lac_resolve_setting LAC_SUGGEST_STRATEGY "$LAC_SUGGEST_STRATEGY")"
typeset -gx LAC_SUGGEST_TIMEOUT_MS="$(_lac_resolve_setting LAC_SUGGEST_TIMEOUT_MS "$LAC_SUGGEST_TIMEOUT_MS")"
typeset -gx LAC_ACCEPT_KEY="$(_lac_resolve_setting LAC_ACCEPT_KEY "$LAC_ACCEPT_KEY")"
typeset -gx LAC_AUTO_CAPTURE_ENABLED="$(_lac_resolve_setting LAC_AUTO_CAPTURE_ENABLED "$LAC_AUTO_CAPTURE_ENABLED")"
typeset -gx LAC_PTY_CAPTURE_MODE="$(_lac_resolve_setting LAC_PTY_CAPTURE_MODE "$LAC_PTY_CAPTURE_MODE")"
typeset -gx LAC_PTY_CAPTURE_ALLOWLIST="$(_lac_resolve_setting LAC_PTY_CAPTURE_ALLOWLIST "$LAC_PTY_CAPTURE_ALLOWLIST")"
typeset -gx LAC_PTY_CAPTURE_BLOCKLIST="$(_lac_resolve_setting LAC_PTY_CAPTURE_BLOCKLIST "$LAC_PTY_CAPTURE_BLOCKLIST")"
typeset -gx LAC_STATE_DIR

typeset -gx LAC_SOCKET_PATH="${LAC_SOCKET_PATH:-$LAC_STATE_DIR/daemon.sock}"
typeset -gx LAC_DB_PATH="${LAC_DB_PATH:-$LAC_STATE_DIR/autocomplete.sqlite}"
typeset -gx LAC_MODEL_NAME="${LAC_MODEL_NAME:-qwen2.5-coder:7b}"
typeset -gx LAC_FAST_MODEL_NAME="${LAC_FAST_MODEL_NAME:-}"
typeset -gx LAC_MODEL_BASE_URL="${LAC_MODEL_BASE_URL:-http://127.0.0.1:11434}"
typeset -gx LAC_SUGGEST_STRATEGY="${LAC_SUGGEST_STRATEGY:-history+model}"
typeset -gx LAC_SUGGEST_TIMEOUT_MS="${LAC_SUGGEST_TIMEOUT_MS:-1200}"
typeset -gx LAC_ACCEPT_KEY="${LAC_ACCEPT_KEY:-tab}"
typeset -gx LAC_AUTO_CAPTURE_ENABLED="${LAC_AUTO_CAPTURE_ENABLED:-0}"
typeset -gx LAC_PTY_CAPTURE_MODE="${LAC_PTY_CAPTURE_MODE:-allowlist}"
typeset -gx LAC_PTY_CAPTURE_ALLOWLIST="${LAC_PTY_CAPTURE_ALLOWLIST:-}"
typeset -gx LAC_PTY_CAPTURE_BLOCKLIST="${LAC_PTY_CAPTURE_BLOCKLIST:-}"

mkdir -p -- "$LAC_STATE_DIR" "$LAC_ASYNC_DIR"

typeset -g LAC_SESSION_ID="${LAC_SESSION_ID:-lac-$$-${EPOCHSECONDS}-${RANDOM}}"
typeset -g LAC_ASYNC_SESSION_DIR="${LAC_ASYNC_SESSION_DIR:-$LAC_ASYNC_DIR/$LAC_SESSION_ID}"
typeset -g LAC_NOTIFY_PIPE_PATH="${LAC_NOTIFY_PIPE_PATH:-$LAC_ASYNC_SESSION_DIR/notify.pipe}"
typeset -g LAC_SUGGESTION=""
typeset -g LAC_SUGGESTION_SOURCE=""
typeset -g LAC_SUGGESTION_STAGE_ROLE=""
typeset -gi LAC_SUGGESTION_ID=0
typeset -g LAC_PENDING_ACCEPT_COMMAND=""
typeset -gi LAC_PENDING_ACCEPT_SUGGESTION_ID=0
typeset -gi LAC_REQUEST_SEQ=0
typeset -gi LAC_APPLIED_STAGE_ORDER=0
typeset -gi LAC_ASYNC_READY=0
typeset -gi LAC_NOTIFY_FD=-1
typeset -gi LAC_LAST_EXIT_CODE=0
typeset -g LAC_ACTIVE_COMMAND=""
typeset -g LAC_COMMAND_CWD=""
typeset -g LAC_COMMAND_REPO_ROOT=""
typeset -g LAC_COMMAND_BRANCH=""
typeset -gi LAC_COMMAND_STARTED_AT_MS=0
typeset -g LAC_CAPTURED_STDOUT=""
typeset -g LAC_CAPTURED_STDERR=""
typeset -gi LAC_AUTO_CAPTURE_ACTIVE=0
typeset -gi LAC_CAPTURE_STDOUT_SAVE_FD=-1
typeset -gi LAC_CAPTURE_STDERR_SAVE_FD=-1
typeset -g LAC_CAPTURE_STDOUT_FILE=""
typeset -g LAC_CAPTURE_STDERR_FILE=""
typeset -gA LAC_PTY_WRAPPED_COMMANDS=()

mkdir -p -- "$LAC_ASYNC_SESSION_DIR"

_lac_now_ms() {
  printf '%d\n' "$(( EPOCHREALTIME * 1000 ))"
}

_lac_repo_root() {
  git rev-parse --show-toplevel 2>/dev/null
}

_lac_git_branch() {
  git symbolic-ref --quiet --short HEAD 2>/dev/null
}

_lac_daemon_inputs_newer_than_pid() {
  [[ -f "$LAC_DAEMON_PID_PATH" ]] || return 0

  if [[ -x "$LAC_DAEMON_BIN" && "$LAC_DAEMON_BIN" -nt "$LAC_DAEMON_PID_PATH" ]]; then
    return 0
  fi

  if [[ -f "$LAC_RUNTIME_ENV_PATH" && "$LAC_RUNTIME_ENV_PATH" -nt "$LAC_DAEMON_PID_PATH" ]]; then
    return 0
  fi

  return 1
}

_lac_trim_capture() {
  setopt localoptions nomultibyte

  local text="$1"
  local marker=$'\n...\n'
  local marker_len="${#marker}"
  local head_len tail_len tail_start total_len

  head_len="$LAC_CAPTURE_HEAD_BYTES"
  tail_len="$LAC_CAPTURE_TAIL_BYTES"

  if (( head_len < 0 )); then
    head_len=0
  fi
  if (( tail_len < 0 )); then
    tail_len=0
  fi

  total_len=$(( head_len + tail_len + marker_len ))

  if (( ${#text} <= total_len )); then
    print -rn -- "$text"
    return 0
  fi

  if (( head_len == 0 && tail_len == 0 )); then
    return 0
  fi

  if (( head_len == 0 )); then
    tail_start=$(( ${#text} - tail_len + 1 ))
    print -rn -- "${text[tail_start,-1]}"
    return 0
  fi

  if (( tail_len == 0 )); then
    print -rn -- "${text[1,head_len]}"
    return 0
  fi

  tail_start=$(( ${#text} - tail_len + 1 ))

  print -rn -- "${text[1,head_len]}${marker}${text[tail_start,-1]}"
}

_lac_set_captured_output() {
  local stdout_text="$1"
  local stderr_text="$2"

  typeset -g LAC_CAPTURED_STDOUT="$(_lac_trim_capture "$stdout_text")"
  typeset -g LAC_CAPTURED_STDERR="$(_lac_trim_capture "$stderr_text")"
}

_lac_sanitize_capture_text() {
  local capture_file="$1"
  local sanitized=""

  [[ -f "$capture_file" ]] || return 0

  if (( $+commands[perl] )); then
    sanitized="$(
      perl -0pe '
        s/\e\[[0-9;?]*[ -\/]*[@-~]//g;
        s/\e\][^\a]*(?:\a|\e\\\\)//g;
        s/\r//g;
        s/\x04//g;
        s/\x08//g;
      ' -- "$capture_file" 2>/dev/null
    )"
  else
    sanitized="$(<"$capture_file")"
    sanitized="${sanitized//$'\r'/}"
    sanitized="${sanitized//$'\x04'/}"
    sanitized="${sanitized//$'\x08'/}"
  fi

  print -rn -- "$sanitized"
}

_lac_auto_capture_enabled() {
  case "${${LAC_AUTO_CAPTURE_ENABLED:-0}:l}" in
    1|true|yes|on|enabled)
      return 0
      ;;
  esac

  return 1
}

_lac_normalize_pty_capture_mode() {
  case "${${1:-allowlist}:l}" in
    blocklist)
      print -rn -- "blocklist"
      ;;
    *)
      print -rn -- "allowlist"
      ;;
  esac
}

_lac_normalize_accept_key() {
  case "${${1:-tab}:l}" in
    right-arrow)
      print -rn -- "right-arrow"
      ;;
    *)
      print -rn -- "tab"
      ;;
  esac
}

_lac_command_name_from_raw() {
  local raw_command="$1"
  local word
  local -a words
  local index=1

  [[ -n "${raw_command//[[:space:]]/}" ]] || return 1
  words=("${(z)raw_command}")
  (( ${#words} > 0 )) || return 1

  while (( index <= ${#words} )); do
    word="$words[$index]"

    if [[ "$word" =~ '^[A-Za-z_][A-Za-z0-9_]*=.*$' ]]; then
      (( index += 1 ))
      continue
    fi

    case "$word" in
      command|builtin|exec|noglob|nocorrect)
        (( index += 1 ))
        continue
        ;;
      time)
        (( index += 1 ))
        while (( index <= ${#words} )) && [[ "${words[$index]}" == -* ]]; do
          (( index += 1 ))
        done
        continue
        ;;
    esac

    print -rn -- "$word"
    return 0
  done

  return 1
}

_lac_trim_pty_capture_rule() {
  local value="$1"

  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  print -rn -- "$value"
}

_lac_is_pty_capture_regex_rule() {
  local rule

  rule="$(_lac_trim_pty_capture_rule "$1")"
  (( ${#rule} >= 2 )) || return 1
  [[ "$rule" == /*/ ]]
}

_lac_list_pty_capture_rules() {
  local list_value="$1"
  local line entry
  local -a lines parts

  lines=("${(@f)${list_value//$'\r'/}}")

  for line in "${lines[@]}"; do
    line="$(_lac_trim_pty_capture_rule "$line")"
    [[ -n "$line" ]] || continue

    if _lac_is_pty_capture_regex_rule "$line"; then
      print -r -- "$line"
      continue
    fi

    parts=("${(@s:,:)line}")
    for entry in "${parts[@]}"; do
      entry="$(_lac_trim_pty_capture_rule "$entry")"
      [[ -n "$entry" ]] || continue
      print -r -- "$entry"
    done
  done
}

_lac_list_has_pty_capture_regex_rule() {
  local rule
  local -a rules

  rules=("${(@f)$(_lac_list_pty_capture_rules "$1")}")
  for rule in "${rules[@]}"; do
    _lac_is_pty_capture_regex_rule "$rule" && return 0
  done

  return 1
}

_lac_command_matches_pty_capture_list() {
  local command_name="$1"
  local raw_command="$2"
  local list_value="$3"
  local rule pattern
  local -a rules

  rules=("${(@f)$(_lac_list_pty_capture_rules "$list_value")}")

  for rule in "${rules[@]}"; do
    if _lac_is_pty_capture_regex_rule "$rule"; then
      pattern="${rule[2,-2]}"
      { [[ "$raw_command" =~ $pattern ]] } 2>/dev/null && return 0
      continue
    fi

    [[ "$rule" == "$command_name" ]] && return 0
  done

  return 1
}

_lac_command_name_in_plain_pty_capture_list() {
  local command_name="$1"
  local list_value="$2"
  local rule
  local -a rules

  rules=("${(@f)$(_lac_list_pty_capture_rules "$list_value")}")

  for rule in "${rules[@]}"; do
    _lac_is_pty_capture_regex_rule "$rule" && continue
    [[ "$rule" == "$command_name" ]] && return 0
  done

  return 1
}

_lac_command_redirection_mode() {
  local raw_command="$1"
  local word fd rest stderr_only=0
  local -a words

  [[ -n "${raw_command//[[:space:]]/}" ]] || {
    print -rn -- "none"
    return 0
  }

  words=("${(z)raw_command}")
  for word in "${words[@]}"; do
    case "$word" in
      "|"|"||"|"&&"|";"|"&")
        print -rn -- "other"
        return 0
        ;;
      "<"*|"<<"*|"<<-"*|"<<<"*|"<&"*|"<>"*|"&>"*|"&>>"*)
        print -rn -- "other"
        return 0
        ;;
    esac

    fd=""
    rest="$word"
    if [[ "$word" == <->* ]]; then
      fd="${word%%[^0-9]*}"
      rest="${word#$fd}"
    fi

    case "$rest" in
      ">"*|">>"*|">|"*|">&"*)
        if [[ "$fd" == "2" ]]; then
          stderr_only=1
          continue
        fi
        print -rn -- "other"
        return 0
        ;;
    esac
  done

  if (( stderr_only )); then
    print -rn -- "stderr-only"
  else
    print -rn -- "none"
  fi
}

_lac_command_matches_pty_capture_policy() {
  local command_name="$1"
  local raw_command="${2:-$1}"
  local mode

  mode="$(_lac_normalize_pty_capture_mode "${LAC_PTY_CAPTURE_MODE:-allowlist}")"
  if [[ "$mode" == "blocklist" ]]; then
    _lac_command_matches_pty_capture_list "$command_name" "$raw_command" "$LAC_PTY_CAPTURE_BLOCKLIST" && return 1
    return 0
  fi

  _lac_command_matches_pty_capture_list "$command_name" "$raw_command" "$LAC_PTY_CAPTURE_ALLOWLIST"
}

_lac_should_pty_wrap_command() {
  local command_name="$1"
  local raw_command="${2:-$1}"

  [[ "$(_lac_command_redirection_mode "$raw_command")" == "none" ]] || return 1
  _lac_command_matches_pty_capture_policy "$command_name" "$raw_command"
}

_lac_is_pty_wrapped_command() {
  local raw_command="$1"
  local command_name=""

  command_name="$(_lac_command_name_from_raw "$raw_command")" || return 1
  [[ -n "${LAC_PTY_WRAPPED_COMMANDS[$command_name]-}" ]] || return 1
  _lac_should_pty_wrap_command "$command_name" "$raw_command"
}

_lac_reset_auto_capture() {
  typeset -gi LAC_AUTO_CAPTURE_ACTIVE=0
  typeset -gi LAC_CAPTURE_STDOUT_SAVE_FD=-1
  typeset -gi LAC_CAPTURE_STDERR_SAVE_FD=-1
  typeset -g LAC_CAPTURE_STDOUT_FILE=""
  typeset -g LAC_CAPTURE_STDERR_FILE=""
}

_lac_should_auto_capture() {
  local raw_command="$1"
  local command_name=""
  local redirection_mode
  local allow_policy_fallback=0
  local -a words
  local word

  [[ -n "${raw_command//[[:space:]]/}" ]] || return 1
  command_name="$(_lac_command_name_from_raw "$raw_command")" || command_name=""

  redirection_mode="$(_lac_command_redirection_mode "$raw_command")"
  if [[ "$redirection_mode" == "stderr-only" ]] && [[ -n "$command_name" ]] && _lac_command_matches_pty_capture_policy "$command_name" "$raw_command"; then
    allow_policy_fallback=1
  fi

  (( allow_policy_fallback )) || _lac_auto_capture_enabled || return 1
  _lac_is_pty_wrapped_command "$raw_command" && return 1
  words=("${(z)raw_command}")
  (( ${#words} > 0 )) || return 1

  if [[ "$words[1]" == "lac-capture" ]]; then
    return 1
  fi

  if [[ "$words[-1]" == "&" ]]; then
    return 1
  fi

  [[ "$redirection_mode" == "other" ]] && return 1

  for word in "${words[@]}"; do
    case "$word" in
      "|"|"||"|"&&"|";"|"&")
        return 1
        ;;
      vim|nvim|vi|nano|less|more|man|top|htop|watch|ssh|sftp|scp|mosh|tmux|screen|fzf)
        return 1
        ;;
    esac
  done

  return 0
}

_lac_begin_auto_capture() {
  local stdout_file stderr_file

  _lac_reset_auto_capture
  stdout_file="$(mktemp "$LAC_ASYNC_SESSION_DIR/auto.stdout.XXXXXX")" || return 1
  stderr_file="$(mktemp "$LAC_ASYNC_SESSION_DIR/auto.stderr.XXXXXX")" || {
    rm -f -- "$stdout_file"
    return 1
  }

  exec {LAC_CAPTURE_STDOUT_SAVE_FD}>&1 || {
    rm -f -- "$stdout_file" "$stderr_file"
    _lac_reset_auto_capture
    return 1
  }
  exec {LAC_CAPTURE_STDERR_SAVE_FD}>&2 || {
    exec {LAC_CAPTURE_STDOUT_SAVE_FD}>&-
    rm -f -- "$stdout_file" "$stderr_file"
    _lac_reset_auto_capture
    return 1
  }

  typeset -g LAC_CAPTURE_STDOUT_FILE="$stdout_file"
  typeset -g LAC_CAPTURE_STDERR_FILE="$stderr_file"

  eval "exec > >(tee \"$LAC_CAPTURE_STDOUT_FILE\" >&$LAC_CAPTURE_STDOUT_SAVE_FD)"
  eval "exec 2> >(tee \"$LAC_CAPTURE_STDERR_FILE\" >&$LAC_CAPTURE_STDERR_SAVE_FD)"
  typeset -gi LAC_AUTO_CAPTURE_ACTIVE=1
  return 0
}

_lac_wait_for_capture_files() {
  local file="$1"
  local previous_size=-1
  local current_size=0
  local attempt

  [[ -f "$file" ]] || return 0

  for attempt in {1..5}; do
    current_size="$(wc -c < "$file" 2>/dev/null || print 0)"
    if [[ "$current_size" == "$previous_size" ]]; then
      return 0
    fi
    previous_size="$current_size"
    sleep 0.01
  done
}

_lac_finish_auto_capture() {
  local stdout_text="" stderr_text=""

  if (( ! LAC_AUTO_CAPTURE_ACTIVE )); then
    return 0
  fi

  eval "exec 1>&$LAC_CAPTURE_STDOUT_SAVE_FD"
  eval "exec 2>&$LAC_CAPTURE_STDERR_SAVE_FD"
  exec {LAC_CAPTURE_STDOUT_SAVE_FD}>&-
  exec {LAC_CAPTURE_STDERR_SAVE_FD}>&-

  _lac_wait_for_capture_files "$LAC_CAPTURE_STDOUT_FILE"
  _lac_wait_for_capture_files "$LAC_CAPTURE_STDERR_FILE"

  [[ -f "$LAC_CAPTURE_STDOUT_FILE" ]] && stdout_text="$(<"$LAC_CAPTURE_STDOUT_FILE")"
  [[ -f "$LAC_CAPTURE_STDERR_FILE" ]] && stderr_text="$(<"$LAC_CAPTURE_STDERR_FILE")"

  _lac_set_captured_output "$stdout_text" "$stderr_text"

  rm -f -- "$LAC_CAPTURE_STDOUT_FILE" "$LAC_CAPTURE_STDERR_FILE"
  _lac_reset_auto_capture
}

_lac_should_use_pty_capture() {
  [[ -o interactive ]] || return 1
  [[ -t 0 && -t 1 ]] || return 1
  (( $+commands[script] )) || return 1
  return 0
}

_lac_called_from_internal_function() {
  local index frame

  for (( index = 4; index <= ${#funcstack}; index += 1 )); do
    frame="$funcstack[$index]"
    case "$frame" in
      _lac_*|lac-capture|lac-capture-pty)
        return 0
        ;;
    esac
  done

  return 1
}

_lac_list_daemon_pids() {
  local line trimmed pid

  ps -axo pid=,command= 2>/dev/null | while IFS= read -r line; do
    [[ "$line" == *"/autocomplete-daemon "* ]] || continue
    trimmed="${line#${line%%[![:space:]]*}}"
    pid="${trimmed%% *}"
    [[ "$pid" == <-> ]] || continue
    print -r -- "$pid"
  done
}

_lac_list_socket_daemon_pids() {
  local socket_path="$1"
  local line trimmed pid

  [[ -n "$socket_path" ]] || return 0

  ps -axo pid=,command= 2>/dev/null | while IFS= read -r line; do
    [[ "$line" == *"/autocomplete-daemon "* && "$line" == *"$socket_path"* ]] || continue
    trimmed="${line#${line%%[![:space:]]*}}"
    pid="${trimmed%% *}"
    [[ "$pid" == <-> ]] || continue
    print -r -- "$pid"
  done
}

_lac_stop_daemon_pids() {
  local pid
  local -a pids=("$@")

  (( ${#pids} > 0 )) || return 0

  for pid in "${pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done

  sleep 0.3

  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
}

_lac_run_pty_wrapped_command() {
  local command_name="$1"
  local raw_command="${LAC_ACTIVE_COMMAND:-$command_name}"
  local active_command_name=""
  shift

  if _lac_called_from_internal_function; then
    command "$command_name" "$@"
    return 0
  fi

  active_command_name="$(_lac_command_name_from_raw "$raw_command")"

  if [[ "$active_command_name" == "$command_name" ]] && _lac_should_use_pty_capture && _lac_should_pty_wrap_command "$command_name" "$raw_command"; then
    lac-capture-pty "$command_name" "$@"
  else
    command "$command_name" "$@"
  fi
}

_lac_install_pty_capture_wrapper_for_command() {
  local command_name="$1"

  [[ "$command_name" =~ '^[A-Za-z0-9_.+-]+$' ]] || return 1
  (( $+commands[$command_name] )) || return 1
  (( $+builtins[$command_name] )) && return 1
  _lac_is_reserved_pty_command "$command_name" && return 1
  (( $+functions[$command_name] )) && return 0
  (( $+aliases[$command_name] )) && return 1

  eval "
function $command_name() {
  _lac_run_pty_wrapped_command \"$command_name\" \"\$@\"
}
"
  LAC_PTY_WRAPPED_COMMANDS[$command_name]=1
  return 0
}

_lac_maybe_install_pty_capture_wrapper_for_command() {
  local raw_command="$1"
  local command_name=""

  command_name="$(_lac_command_name_from_raw "$raw_command")" || return 1
  [[ -n "$command_name" ]] || return 1

  _lac_should_pty_wrap_command "$command_name" "$raw_command" || return 1
  _lac_install_pty_capture_wrapper_for_command "$command_name"
}

_lac_prepare_buffer_for_execution() {
  local raw_command="$BUFFER"

  if [[ -n "$LAC_SUGGESTION" || -n "${POSTDISPLAY-}" ]]; then
    _lac_clear_suggestion
    zle redisplay 2>/dev/null || true
  fi

  [[ -n "${raw_command//[[:space:]]/}" ]] || return 0
  _lac_maybe_install_pty_capture_wrapper_for_command "$raw_command" || true
}

_lac_is_reserved_pty_command() {
  local command_name="$1"

  case "$command_name" in
    script|mktemp|rm|wc|sleep|perl|mkfifo|mkdir|tee)
      return 0
      ;;
  esac

  return 1
}

_lac_clear_suggestion() {
  typeset -g LAC_SUGGESTION=""
  typeset -g LAC_SUGGESTION_SOURCE=""
  typeset -g LAC_SUGGESTION_STAGE_ROLE=""
  typeset -gi LAC_SUGGESTION_ID=0
  POSTDISPLAY=""
  _lac_clear_highlight
}

_lac_clear_pending_acceptance() {
  typeset -g LAC_PENDING_ACCEPT_COMMAND=""
  typeset -gi LAC_PENDING_ACCEPT_SUGGESTION_ID=0
}

_lac_clear_highlight() {
  local entry
  local -a filtered=()

  for entry in "${region_highlight[@]}"; do
    [[ "$entry" == *"memo=lac-suggestion"* ]] || filtered+=("$entry")
  done

  region_highlight=("${filtered[@]}")
}

_lac_format_suggestion_source_marker() {
  local source="$1"
  local stage_role="$2"
  local tag label joined=""
  local normalized="${source//+/ }"
  local -a tags=(${=normalized})
  typeset -A seen_labels=()

  for tag in "${tags[@]}"; do
    case "$tag" in
      history)
        label="history"
        ;;
      model)
        case "$LAC_SUGGEST_STRATEGY:$stage_role" in
          history-then-fast-then-model:fast|history-then-fast-then-model:slow|fast-then-model:fast|fast-then-model:slow)
            label="ai/$stage_role"
            ;;
          *)
            label="ai"
            ;;
        esac
        ;;
      "")
        continue
        ;;
      *)
        label="ranking"
        ;;
    esac

    [[ -n "${seen_labels[$label]-}" ]] && continue
    seen_labels[$label]=1

    if [[ -n "$joined" ]]; then
      joined+="+"
    fi
    joined+="$label"
  done

  [[ -n "$joined" ]] || return 0
  print -rn -- " [$joined]"
}

_lac_snapshot_field() {
  local value="$1"
  value="${value//$'\t'/ }"
  value="${value//$'\n'/ }"
  value="${value//$'\r'/ }"
  print -rn -- "$value"
}

_lac_write_snapshot() {
  local event="$1"

  [[ -n "$LAC_SNAPSHOT_PATH" ]] || return 0

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$event" \
    "$(_lac_snapshot_field "$BUFFER")" \
    "$(_lac_snapshot_field "${POSTDISPLAY-}")" \
    "$(_lac_snapshot_field "$LAC_SUGGESTION")" \
    "$(_lac_snapshot_field "$LAC_SUGGESTION_SOURCE")" \
    "${CURSOR:-0}" \
    "${LAC_ASYNC_READY:-0}" \
    "${LAC_REQUEST_SEQ:-0}" >>| "$LAC_SNAPSHOT_PATH"
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

  POSTDISPLAY="${LAC_SUGGESTION#$BUFFER}$(_lac_format_suggestion_source_marker "$LAC_SUGGESTION_SOURCE" "$LAC_SUGGESTION_STAGE_ROLE")"
  _lac_clear_highlight

  if [[ -n "$POSTDISPLAY" ]]; then
    local highlight_start=${#BUFFER}
    local highlight_end=$(( ${#BUFFER} + ${#POSTDISPLAY} ))
    region_highlight+=("${highlight_start} ${highlight_end} ${LAC_HIGHLIGHT_STYLE} memo=lac-suggestion")
  fi
}

_lac_write_latest_seq() {
  print -rn -- "$LAC_REQUEST_SEQ" >| "$LAC_ASYNC_SESSION_DIR/latest.seq"
}

_lac_invalidate_pending() {
  (( LAC_REQUEST_SEQ += 1 ))
  typeset -gi LAC_APPLIED_STAGE_ORDER=0
  _lac_write_latest_seq
}

_lac_single_request_strategy() {
  case "$LAC_SUGGEST_STRATEGY" in
    history-then-model|history-then-fast-then-model)
      print -r -- "history+model-always"
      ;;
    fast-then-model)
      print -r -- "model-only"
      ;;
    *)
      print -r -- "$LAC_SUGGEST_STRATEGY"
      ;;
  esac
}

_lac_single_request_model() {
  case "$LAC_SUGGEST_STRATEGY" in
    history-then-model|history-then-fast-then-model|fast-then-model)
      print -r -- "$LAC_MODEL_NAME"
      ;;
    *)
      print -r -- ""
      ;;
  esac
}

_lac_single_request_stage_role() {
  case "$LAC_SUGGEST_STRATEGY" in
    history-then-fast-then-model|fast-then-model)
      print -r -- "slow"
      ;;
    *)
      print -r -- ""
      ;;
  esac
}

_lac_parse_suggestion_line() {
  local line="$1"
  local rest=""
  typeset -ga LAC_PARSED_SUGGESTION_FIELDS
  LAC_PARSED_SUGGESTION_FIELDS=(0 "" "" "")

  if [[ -z "$line" ]]; then
    return 0
  fi

  local suggestion_id suggestion source stage_role

  if [[ "$line" == *$'\t'* ]]; then
    suggestion_id="${line%%$'\t'*}"
    rest="${line#*$'\t'}"
  else
    suggestion_id="$line"
    rest=""
  fi

  if [[ "$rest" == *$'\t'* ]]; then
    suggestion="${rest%%$'\t'*}"
    rest="${rest#*$'\t'}"
  else
    suggestion="$rest"
    rest=""
  fi

  if [[ "$rest" == *$'\t'* ]]; then
    source="${rest%%$'\t'*}"
    stage_role="${rest#*$'\t'}"
  else
    source="$rest"
    stage_role=""
  fi

  LAC_PARSED_SUGGESTION_FIELDS=("$suggestion_id" "$suggestion" "$source" "$stage_role")
}

_lac_request_suggestion() {
  local buffer="$1"
  local cwd="$2"
  local repo_root="$3"
  local branch="$4"
  local strategy="${5:-}"
  local model_name="${6:-}"

  local -a command=(
    "$LAC_CLIENT_BIN" suggest
    --socket "$LAC_SOCKET_PATH"
    --session "$LAC_SESSION_ID"
    --buffer "$buffer"
    --cwd "$cwd"
    --repo-root "$repo_root"
    --branch "$branch"
    --last-exit "$LAC_LAST_EXIT_CODE"
  )

  [[ -n "$strategy" ]] && command+=(--strategy "$strategy")
  [[ -n "$model_name" ]] && command+=(--model "$model_name")

  "${command[@]}" 2>/dev/null
}

_lac_refresh_suggestion_sync() {
  local repo_root branch line suggestion_id suggestion source stage_role strategy model_name

  if (( CURSOR != ${#BUFFER} )); then
    _lac_clear_suggestion
    return 0
  fi

  repo_root="$(_lac_repo_root)"
  branch="$(_lac_git_branch)"
  strategy="$(_lac_single_request_strategy)"
  model_name="$(_lac_single_request_model)"
  line="$(_lac_request_suggestion "$BUFFER" "$PWD" "$repo_root" "$branch" "$strategy" "$model_name")"
  _lac_parse_suggestion_line "$line"
  suggestion_id="$LAC_PARSED_SUGGESTION_FIELDS[1]"
  suggestion="$LAC_PARSED_SUGGESTION_FIELDS[2]"
  source="$LAC_PARSED_SUGGESTION_FIELDS[3]"
  stage_role="$LAC_PARSED_SUGGESTION_FIELDS[4]"
  [[ -n "$stage_role" ]] || stage_role="$(_lac_single_request_stage_role)"

  if [[ -z "$suggestion" || "$suggestion" != "$BUFFER"* || ( -n "$BUFFER" && "$suggestion" == "$BUFFER" ) ]]; then
    _lac_clear_suggestion
    return 0
  fi

  typeset -gi LAC_SUGGESTION_ID="$suggestion_id"
  typeset -g LAC_SUGGESTION="$suggestion"
  typeset -g LAC_SUGGESTION_SOURCE="$source"
  typeset -g LAC_SUGGESTION_STAGE_ROLE="$stage_role"
  typeset -gi LAC_APPLIED_STAGE_ORDER=1
  _lac_render_suggestion
  _lac_write_snapshot "async-applied"
}

_lac_apply_async_result() {
  local file seq line suggestion_id suggestion source stage_role file_name base_name stage_order stage_total
  local files=("$LAC_ASYNC_SESSION_DIR"/*.tsv(N))

  for file in $files; do
    file_name="${file:t}"
    base_name="${file_name%.tsv}"
    seq="${base_name%%.*}"
    if [[ "$seq" != <-> ]]; then
      rm -f -- "$file"
      continue
    fi
    if (( seq < LAC_REQUEST_SEQ )); then
      rm -f -- "$file"
    fi
  done

  files=("$LAC_ASYNC_SESSION_DIR/$LAC_REQUEST_SEQ".*.tsv(N) "$LAC_ASYNC_SESSION_DIR/$LAC_REQUEST_SEQ.tsv"(N))
  (( ${#files[@]} > 0 )) || return 0

  for file in $files; do
    file_name="${file:t}"
    base_name="${file_name%.tsv}"
    stage_order=1
    stage_total=1
    if [[ "$base_name" == *.*.* ]]; then
      local -a parts=("${(@s:.:)base_name}")
      if (( ${#parts[@]} == 3 )) && [[ "${parts[1]}" == "$LAC_REQUEST_SEQ" ]] && [[ "${parts[2]}" == <-> ]] && [[ "${parts[3]}" == <-> ]]; then
        stage_order="${parts[2]}"
        stage_total="${parts[3]}"
      fi
    fi

    IFS= read -r line < "$file"
    rm -f -- "$file"

    if (( stage_order <= LAC_APPLIED_STAGE_ORDER )); then
      continue
    fi

    _lac_parse_suggestion_line "$line"
    suggestion_id="$LAC_PARSED_SUGGESTION_FIELDS[1]"
    suggestion="$LAC_PARSED_SUGGESTION_FIELDS[2]"
    source="$LAC_PARSED_SUGGESTION_FIELDS[3]"
    stage_role="$LAC_PARSED_SUGGESTION_FIELDS[4]"

    if [[ -z "$suggestion" || ( -n "$BUFFER" && "$suggestion" == "$BUFFER" ) || "$suggestion" != "$BUFFER"* ]]; then
      if (( stage_order == stage_total && LAC_APPLIED_STAGE_ORDER == 0 )); then
        _lac_clear_suggestion
      fi
      continue
    fi

    if (( CURSOR != ${#BUFFER} )); then
      continue
    fi

    typeset -gi LAC_SUGGESTION_ID="$suggestion_id"
    typeset -g LAC_SUGGESTION="$suggestion"
    typeset -g LAC_SUGGESTION_SOURCE="$source"
    typeset -g LAC_SUGGESTION_STAGE_ROLE="$stage_role"
    typeset -gi LAC_APPLIED_STAGE_ORDER="$stage_order"
  done

  _lac_render_suggestion
}

_lac_flush_async_result() {
  if (( ! LAC_ASYNC_READY )); then
    return 0
  fi

  typeset -gi LAC_ASYNC_READY=0
  _lac_apply_async_result
}

_lac_async_notify_handler() {
  local fd="$1"
  local notice=""

  IFS= read -r -u "$fd" notice || return 0
  typeset -gi LAC_ASYNC_READY=1
  _lac_write_snapshot "notify:${notice}"
  _lac_flush_async_result
  _lac_render_suggestion
  _lac_write_snapshot "notify-applied:${notice}"
  zle -R 2>/dev/null || true
}

_lac_ensure_async_notifier() {
  if (( LAC_NOTIFY_FD >= 0 )); then
    return 0
  fi

  mkdir -p -- "$LAC_ASYNC_SESSION_DIR"
  rm -f -- "$LAC_NOTIFY_PIPE_PATH"
  mkfifo "$LAC_NOTIFY_PIPE_PATH" || return 1
  exec {LAC_NOTIFY_FD}<>"$LAC_NOTIFY_PIPE_PATH" || return 1
  zle -F -w "$LAC_NOTIFY_FD" lac-async-notify 2>/dev/null || return 1
  return 0
}

_lac_zle_line_init() {
  _lac_ensure_async_notifier || true
  if (( CURSOR == ${#BUFFER} )); then
    _lac_schedule_suggestion
  fi
}

_lac_schedule_suggestion() {
  local buffer cwd repo_root branch seq latest_file notify_pipe result_file shell_pid

  if (( CURSOR != ${#BUFFER} )); then
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
  typeset -gi LAC_APPLIED_STAGE_ORDER=0
  latest_file="$LAC_ASYNC_SESSION_DIR/latest.seq"
  result_file="$LAC_ASYNC_SESSION_DIR/$seq.tsv"
  shell_pid=$$
  notify_pipe=""

  _lac_write_latest_seq

  if [[ -n "$LAC_SUGGESTION" && "$LAC_SUGGESTION" != "$BUFFER"* ]]; then
    _lac_clear_suggestion
  else
    _lac_render_suggestion
  fi

  _lac_write_snapshot "scheduled:${shell_pid}:${seq}"

  [[ -x "$LAC_ASYNC_HELPER_BIN" ]] || return 0

  if _lac_ensure_async_notifier; then
    notify_pipe="$LAC_NOTIFY_PIPE_PATH"
  fi

  "$LAC_ASYNC_HELPER_BIN" \
    "$LAC_DEBOUNCE_SECONDS" \
    "$latest_file" \
    "$seq" \
    "$result_file" \
    "$LAC_CLIENT_BIN" \
    "$LAC_SOCKET_PATH" \
    "$LAC_SESSION_ID" \
    "$buffer" \
    "$cwd" \
    "$repo_root" \
    "$branch" \
    "$LAC_LAST_EXIT_CODE" \
    "$notify_pipe" \
    "$LAC_SNAPSHOT_PATH" </dev/null &!
}

_lac_zle_line_pre_redraw() {
  _lac_flush_async_result
  _lac_render_suggestion
  _lac_write_snapshot "pre-redraw"
}

_lac_after_buffer_change() {
  _lac_flush_async_result

  if (( CURSOR != ${#BUFFER} )); then
    _lac_invalidate_pending
    _lac_clear_suggestion
    _lac_write_snapshot "buffer-cleared"
    return 0
  fi

  if [[ -n "$LAC_SUGGESTION" && "$LAC_SUGGESTION" == "$BUFFER"* ]]; then
    _lac_render_suggestion
  else
    _lac_clear_suggestion
  fi

  _lac_write_snapshot "buffer-change"
  _lac_schedule_suggestion
}

_lac_feedback_for() {
  local event_type="$1"
  local suggestion_id="$2"
  local suggestion_text="$3"
  local accepted_command="${4:-}"
  local actual_command="${5:-}"
  local buffer_value="${6:-$BUFFER}"

  (( suggestion_id > 0 )) || return 0
  [[ -x "$LAC_CLIENT_BIN" ]] || return 0

  "$LAC_CLIENT_BIN" feedback \
    --socket "$LAC_SOCKET_PATH" \
    --session "$LAC_SESSION_ID" \
    --suggestion-id "$suggestion_id" \
    --event "$event_type" \
    --buffer "$buffer_value" \
    --suggestion "$suggestion_text" \
    --accepted-command "$accepted_command" \
    --actual-command "$actual_command" >/dev/null 2>&1 &!
}

_lac_feedback() {
  local event_type="$1"
  local accepted_command="${2:-}"
  local actual_command="${3:-}"

  _lac_feedback_for \
    "$event_type" \
    "$LAC_SUGGESTION_ID" \
    "$LAC_SUGGESTION" \
    "$accepted_command" \
    "$actual_command" \
    "$BUFFER"
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

  if (( LAC_PENDING_ACCEPT_SUGGESTION_ID > 0 )) && [[ -n "$LAC_PENDING_ACCEPT_COMMAND" ]]; then
    if [[ "$command" == "$LAC_PENDING_ACCEPT_COMMAND" ]]; then
      _lac_feedback_for \
        "executed_unchanged" \
        "$LAC_PENDING_ACCEPT_SUGGESTION_ID" \
        "$LAC_PENDING_ACCEPT_COMMAND" \
        "$LAC_PENDING_ACCEPT_COMMAND" \
        "$command" \
        "$LAC_PENDING_ACCEPT_COMMAND"
    else
      _lac_feedback_for \
        "executed_edited" \
        "$LAC_PENDING_ACCEPT_SUGGESTION_ID" \
        "$LAC_PENDING_ACCEPT_COMMAND" \
        "$LAC_PENDING_ACCEPT_COMMAND" \
        "$command" \
        "$LAC_PENDING_ACCEPT_COMMAND"
    fi
    _lac_clear_pending_acceptance
  elif (( LAC_SUGGESTION_ID > 0 )) && [[ -n "$LAC_SUGGESTION" ]] && [[ "$command" != "$LAC_SUGGESTION" ]]; then
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

  _lac_maybe_install_pty_capture_wrapper_for_command "$command" || true

  if _lac_should_auto_capture "$raw_command"; then
    _lac_begin_auto_capture || true
  fi
}

_lac_precmd() {
  local exit_code="$?"
  local finished_at_ms duration_ms stdout_excerpt stderr_excerpt

  _lac_finish_auto_capture

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
  _lac_reset_auto_capture
  typeset -gi LAC_LAST_EXIT_CODE="$exit_code"
}

lac-start-daemon() {
  local _ attempt daemon_pid keep_pid
  local -a active_pids all_pids competing_pids

  mkdir -p -- "$LAC_STATE_DIR" "$LAC_ASYNC_DIR"
  [[ -x "$LAC_CLIENT_BIN" && -x "$LAC_DAEMON_BIN" ]] || return 1

  if "$LAC_CLIENT_BIN" health --socket "$LAC_SOCKET_PATH" >/dev/null 2>&1; then
    active_pids=(${(f)"$(_lac_list_socket_daemon_pids "$LAC_SOCKET_PATH")"})
    keep_pid="${active_pids[1]-}"
    if [[ -n "$keep_pid" ]] && ! _lac_daemon_inputs_newer_than_pid; then
      all_pids=(${(f)"$(_lac_list_daemon_pids)"})
      competing_pids=()
      for daemon_pid in "${all_pids[@]}"; do
        [[ -n "$keep_pid" && "$daemon_pid" == "$keep_pid" ]] && continue
        competing_pids+=("$daemon_pid")
      done
      _lac_stop_daemon_pids "${competing_pids[@]}"
      return 0
    fi

    all_pids=(${(f)"$(_lac_list_daemon_pids)"})
    _lac_stop_daemon_pids "${all_pids[@]}"
  fi

  all_pids=(${(f)"$(_lac_list_daemon_pids)"})
  _lac_stop_daemon_pids "${all_pids[@]}"

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

  _lac_set_captured_output "$stdout_text" "$stderr_text"

  rm -f -- "$stdout_file" "$stderr_file"
  return "$cmd_status"
}

lac-capture-pty() {
  local capture_file cmd_status captured_text

  if (( $# == 0 )); then
    return 1
  fi

  if ! _lac_should_use_pty_capture; then
    command "$@"
    return $?
  fi

  capture_file="$(mktemp "$LAC_ASYNC_DIR/capture.pty.XXXXXX")" || {
    command "$@"
    return $?
  }

  command script -q "$capture_file" "$@"
  cmd_status=$?
  captured_text="$(_lac_sanitize_capture_text "$capture_file")"

  if (( cmd_status == 0 )); then
    _lac_set_captured_output "$captured_text" ""
  else
    _lac_set_captured_output "" "$captured_text"
  fi

  rm -f -- "$capture_file"
  return "$cmd_status"
}

lac-accept-or-complete() {
  if _lac_accept_suggestion_if_ready; then
    return 0
  fi

  zle expand-or-complete
}

lac-accept-or-forward-char() {
  if _lac_accept_suggestion_if_ready; then
    return 0
  fi

  zle forward-char
}

_lac_accept_suggestion_if_ready() {
  if [[ -n "$LAC_SUGGESTION" && "$LAC_SUGGESTION" == "$BUFFER"* && $CURSOR -eq ${#BUFFER} ]]; then
    local accepted_command="$LAC_SUGGESTION"
    typeset -gi LAC_PENDING_ACCEPT_SUGGESTION_ID="$LAC_SUGGESTION_ID"
    typeset -g LAC_PENDING_ACCEPT_COMMAND="$accepted_command"
    BUFFER="$accepted_command"
    CURSOR=${#BUFFER}
    _lac_feedback "accepted_buffer" "$accepted_command" ""
    _lac_after_buffer_change
    zle redisplay
    return 0
  fi

  return 1
}

_lac_bind_widget_in_insert_keymaps() {
  local sequence="$1"
  local widget="$2"
  local keymap

  bindkey "$sequence" "$widget" 2>/dev/null || true

  for keymap in emacs viins main; do
    bindkey -M "$keymap" "$sequence" "$widget" 2>/dev/null || true
  done
}

_lac_bind_accept_widget() {
  local accept_key right_arrow_sequence
  local -A seen_sequences=()
  local -a right_arrow_sequences

  accept_key="$(_lac_normalize_accept_key "$LAC_ACCEPT_KEY")"
  right_arrow_sequences=()

  right_arrow_sequence="${terminfo[kcuf1]:-}"
  if [[ -n "$right_arrow_sequence" && -z "${seen_sequences[$right_arrow_sequence]:-}" ]]; then
    right_arrow_sequences+=("$right_arrow_sequence")
    seen_sequences[$right_arrow_sequence]=1
  fi

  for right_arrow_sequence in $'\e[C' $'\eOC'; do
    if [[ -z "${seen_sequences[$right_arrow_sequence]:-}" ]]; then
      right_arrow_sequences+=("$right_arrow_sequence")
      seen_sequences[$right_arrow_sequence]=1
    fi
  done

  if [[ "$accept_key" == "right-arrow" ]]; then
    for right_arrow_sequence in "${right_arrow_sequences[@]}"; do
      _lac_bind_widget_in_insert_keymaps "$right_arrow_sequence" lac-accept-or-forward-char
    done
  else
    _lac_bind_widget_in_insert_keymaps '^I' lac-accept-or-complete
  fi
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

_lac_wrap_accept_widget() {
  local widget="$1"
  local safe_name="${widget//-/_}"
  local original_widget="_lac_orig_${safe_name}"
  local wrapper_function="_lac_accept_${safe_name}"

  zle -A "$widget" "$original_widget" 2>/dev/null || return 0

  eval "
function $wrapper_function() {
  _lac_prepare_buffer_for_execution
  zle $original_widget -- \"\$@\"
}
"

  zle -N "$widget" "$wrapper_function"
}

zle -N lac-accept-or-complete
zle -N lac-accept-or-forward-char
zle -N lac-async-notify _lac_async_notify_handler
zle -N zle-line-init _lac_zle_line_init
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

for widget in \
  accept-line \
  accept-and-hold; do
  _lac_wrap_accept_widget "$widget"
done

_lac_bind_accept_widget

add-zsh-hook preexec _lac_preexec
add-zsh-hook precmd _lac_precmd

if [[ -o interactive ]]; then
  lac-start-daemon >/dev/null 2>&1 || true
fi
