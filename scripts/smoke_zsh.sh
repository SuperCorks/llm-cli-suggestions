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

export ROOT_DIR SOCKET_PATH DB_PATH MODEL_NAME
zsh -dfi -c '
  export LAC_CLIENT_BIN="$ROOT_DIR/bin/autocomplete-client"
  export LAC_DAEMON_BIN="$ROOT_DIR/bin/autocomplete-daemon"
  export LAC_SOCKET_PATH="$SOCKET_PATH"
  source "$ROOT_DIR/zsh/cli-auto-complete.zsh"

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

echo "shell smoke test passed"
echo "commands=$commands_count suggestions=$suggestions_count accepted=$accepted_count rejected=$rejected_count output_captured=$stdout_capture_count"
