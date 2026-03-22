#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lac-smoke.XXXXXX")"
SOCKET_PATH="$TMP_DIR/daemon.sock"
DB_PATH="$TMP_DIR/autocomplete.sqlite"
LOG_PATH="$TMP_DIR/daemon.log"
MODEL_NAME="${LAC_SMOKE_MODEL:-llama3.2:latest}"
DAEMON_PID=""

cleanup() {
  if [[ -n "${DAEMON_PID:-}" ]]; then
    kill "$DAEMON_PID" >/dev/null 2>&1 || true
    wait "$DAEMON_PID" >/dev/null 2>&1 || true
  fi
  find "$TMP_DIR" -type f -delete 2>/dev/null || true
  find "$TMP_DIR" -type s -delete 2>/dev/null || true
  rmdir "$TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$ROOT_DIR/bin"
if [[ ! -x "$ROOT_DIR/bin/autocomplete-daemon" || ! -x "$ROOT_DIR/bin/autocomplete-client" ]]; then
  make -C "$ROOT_DIR" build >/dev/null
fi

LAC_STATE_DIR="$TMP_DIR" \
LAC_SOCKET_PATH="$SOCKET_PATH" \
LAC_DB_PATH="$DB_PATH" \
LAC_MODEL_NAME="$MODEL_NAME" \
"$ROOT_DIR/bin/autocomplete-daemon" >"$LOG_PATH" 2>&1 &
DAEMON_PID=$!

for _ in $(seq 1 20); do
  if LAC_SOCKET_PATH="$SOCKET_PATH" "$ROOT_DIR/bin/autocomplete-client" health >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

LAC_SOCKET_PATH="$SOCKET_PATH" "$ROOT_DIR/bin/autocomplete-client" health >/dev/null

cat >"$TMP_DIR/runtime.env" <<EOF
LAC_MODEL_NAME="$MODEL_NAME"
LAC_MODEL_BASE_URL="http://127.0.0.1:11434"
LAC_SUGGEST_STRATEGY="history+model"
LAC_SOCKET_PATH="$SOCKET_PATH"
LAC_DB_PATH="$DB_PATH"
LAC_SUGGEST_TIMEOUT_MS="1200"
LAC_PTY_CAPTURE_ALLOWLIST="uname"
EOF

export ROOT_DIR SOCKET_PATH DB_PATH MODEL_NAME TMP_DIR
script -q /dev/null zsh -dfi -c '
  export LAC_CLIENT_BIN="$ROOT_DIR/bin/autocomplete-client"
  export LAC_DAEMON_BIN="$ROOT_DIR/bin/autocomplete-daemon"
  export LAC_SOCKET_PATH="$SOCKET_PATH"
  export LAC_STATE_DIR="$TMP_DIR"
  source "$ROOT_DIR/zsh/llm-cli-suggestions.zsh"

  lac-start-daemon

  binding="$(bindkey "^I")"
  [[ "$binding" == *"lac-accept-or-complete"* ]] || {
    print -u2 -- "expected Tab to be bound to lac-accept-or-complete, got: $binding"
    return 1
  }

  _lac_preexec "git status"
  true
  _lac_precmd
  sleep 0.3

  BUFFER="git st"
  CURSOR=${#BUFFER}
  _lac_refresh_suggestion_sync
  [[ "$LAC_SUGGESTION" == "git status" ]] || {
    print -u2 -- "expected git status suggestion, got: $LAC_SUGGESTION"
    return 1
  }

  function zle() { return 0; }
  lac-accept-or-complete
  [[ "$BUFFER" == "git status" ]] || {
    print -u2 -- "expected accept widget to populate buffer, got: $BUFFER"
    return 1
  }

  BUFFER="git st"
  CURSOR=${#BUFFER}
  _lac_refresh_suggestion_sync
  [[ "$LAC_SUGGESTION" == "git status" ]] || {
    print -u2 -- "expected git status suggestion before reject, got: $LAC_SUGGESTION"
    return 1
  }

  _lac_preexec "git stash"
  false
  _lac_precmd
  sleep 0.3

  (( $+functions[uname] )) || {
    print -u2 -- "expected uname PTY wrapper to be installed from allowlist"
    return 1
  }

  _lac_preexec "printf hello-plain"
  printf "hello-plain\n"
  _lac_precmd
  sleep 0.3

  _lac_preexec "uname -s"
  uname -s
  _lac_precmd
  sleep 0.3

  _lac_preexec "printf skipped > $TMP_DIR/skipped.txt"
  printf "skipped\n" > "$TMP_DIR/skipped.txt"
  _lac_precmd
  sleep 0.3

  _lac_preexec "lac-capture printf hello"
  lac-capture printf "hello\n" >/dev/null
  _lac_precmd
  sleep 0.3
'

commands_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text in ('git status','git stash');")"
accepted_count="$(sqlite3 "$DB_PATH" "select count(*) from feedback_events where event_type = 'accepted' and accepted_command = 'git status';")"
rejected_count="$(sqlite3 "$DB_PATH" "select count(*) from feedback_events where event_type = 'rejected' and actual_command = 'git stash';")"
suggestions_count="$(sqlite3 "$DB_PATH" "select count(*) from suggestions where suggestion_text = 'git status';")"
stdout_capture_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text like 'printf%' and stdout_excerpt like '%hello%';")"
plain_uncaptured_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text = 'printf hello-plain' and stdout_excerpt = '' and stderr_excerpt = '';")"
pty_stdout_capture_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text = 'uname -s' and stdout_excerpt like '%Darwin%';")"
skipped_redirect_capture_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text like 'printf skipped >%' and stdout_excerpt = '' and stderr_excerpt = '';")"

trimmed_capture_test="$(zsh -dfi -c 'source "'"$ROOT_DIR"'/zsh/llm-cli-suggestions.zsh"; export LAC_CAPTURE_BYTES=24; sample=$'"'"'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta'"'"'; trimmed="$(_lac_trim_capture "$sample")"; print -r -- "$trimmed"' )"

[[ "$commands_count" -ge 2 ]] || {
  echo "expected at least 2 recorded commands, got $commands_count" >&2
  exit 1
}

[[ "$accepted_count" -ge 1 ]] || {
  echo "expected at least 1 accepted feedback event, got $accepted_count" >&2
  exit 1
}

[[ "$rejected_count" -ge 1 ]] || {
  echo "expected at least 1 rejected feedback event, got $rejected_count" >&2
  exit 1
}

[[ "$suggestions_count" -ge 2 ]] || {
  echo "expected at least 2 suggestion rows, got $suggestions_count" >&2
  exit 1
}

[[ "$stdout_capture_count" -ge 1 ]] || {
  echo "expected at least 1 output-captured command, got $stdout_capture_count" >&2
  exit 1
}

[[ "$plain_uncaptured_count" -ge 1 ]] || {
  echo "expected non-allowlisted command to remain uncaptured, got $plain_uncaptured_count" >&2
  exit 1
}

[[ "$pty_stdout_capture_count" -ge 1 ]] || {
  echo "expected PTY output capture for uname -s, got $pty_stdout_capture_count" >&2
  exit 1
}

[[ "$skipped_redirect_capture_count" -ge 1 ]] || {
  echo "expected skipped capture for redirected printf command, got $skipped_redirect_capture_count" >&2
  exit 1
}

[[ "$trimmed_capture_test" == *"alpha"* && "$trimmed_capture_test" == *"zeta"* && "$trimmed_capture_test" == *$'\n...\n'* ]] || {
  echo "expected trimmed capture to retain both start and end, got: $trimmed_capture_test" >&2
  exit 1
}

echo "shell smoke test passed"
echo "commands=$commands_count suggestions=$suggestions_count accepted=$accepted_count rejected=$rejected_count output_captured=$stdout_capture_count plain_uncaptured=$plain_uncaptured_count pty_output_captured=$pty_stdout_capture_count skipped_redirect_capture=$skipped_redirect_capture_count"
