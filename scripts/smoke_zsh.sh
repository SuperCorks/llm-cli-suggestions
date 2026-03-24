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
LAC_ACCEPT_KEY="tab"
LAC_PTY_CAPTURE_MODE="allowlist"
LAC_PTY_CAPTURE_ALLOWLIST=$'/^uname -s$/\n/^uname -r 2>\\/dev\\/null$/'
LAC_PTY_CAPTURE_BLOCKLIST=""
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

  _lac_preexec "npm run dev"
  true
  _lac_precmd
  sleep 0.3

  _lac_preexec "npm run"
  true
  _lac_precmd
  sleep 0.3

  _lac_preexec "git puhs"
  false
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

  _lac_preexec "printf hello-plain"
  printf "hello-plain\n"
  _lac_precmd
  sleep 0.3

  _lac_preexec "uname -s"
  (( $+functions[uname] )) || {
    print -u2 -- "expected uname PTY wrapper to be installed lazily for allowlist match"
    return 1
  }
  uname -s
  _lac_precmd
  sleep 0.3
  _lac_preexec "uname -r 2>/dev/null"
  uname -r 2>/dev/null
  _lac_precmd
  sleep 0.3

  _lac_preexec "uname -m"
  uname -m
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

  BUFFER="npm"
  CURSOR=${#BUFFER}
  _lac_refresh_suggestion_sync
  [[ "$LAC_SUGGESTION" == "npm run"* ]] || {
    print -u2 -- "expected npm run-prefixed suggestion, got: $LAC_SUGGESTION"
    return 1
  }

  function _lac_schedule_suggestion() {
    _lac_refresh_suggestion_sync
  }

  function _lac_request_suggestion() {
    local buffer="$1"
    if [[ -z "$buffer" ]]; then
      printf "%s\t%s\t%s\n" "999" "git push" "model"
      return 0
    fi
    if [[ "$buffer" == "npm" ]]; then
      printf "%s\t%s\t%s\n" "1000" "npm run" "history"
      return 0
    fi
    if [[ "$buffer" == "npm run" ]]; then
      printf "%s\t%s\t%s\n" "1001" "npm run dev" "history"
      return 0
    fi
    "$LAC_CLIENT_BIN" suggest \
      --socket "$LAC_SOCKET_PATH" \
      --session "$LAC_SESSION_ID" \
      --buffer "$buffer" \
      --cwd "$2" \
      --repo-root "$3" \
      --branch "$4" \
      --last-exit "$LAC_LAST_EXIT_CODE" 2>/dev/null
  }

  BUFFER=""
  CURSOR=${#BUFFER}
  _lac_refresh_suggestion_sync
  [[ "$LAC_SUGGESTION" == "git push" ]] || {
    print -u2 -- "expected empty-buffer suggestion, got: $LAC_SUGGESTION"
    return 1
  }

  lac-accept-or-complete
  [[ "$BUFFER" == "git push" ]] || {
    print -u2 -- "expected empty-buffer accept to populate full command, got: $BUFFER"
    return 1
  }

  BUFFER="npm"
  CURSOR=${#BUFFER}
  _lac_refresh_suggestion_sync

  lac-accept-or-complete
  [[ "$BUFFER" == "npm run" ]] || {
    print -u2 -- "expected accept widget to populate chained buffer, got: $BUFFER"
    return 1
  }
  [[ "$LAC_SUGGESTION" == "npm run dev" ]] || {
    print -u2 -- "expected follow-up suggestion after accept, got: $LAC_SUGGESTION"
    return 1
  }
'

script -q /dev/null zsh -dfi -c '
  export LAC_CLIENT_BIN="$ROOT_DIR/bin/autocomplete-client"
  export LAC_DAEMON_BIN="$ROOT_DIR/bin/autocomplete-daemon"
  export LAC_SOCKET_PATH="$SOCKET_PATH"
  export LAC_STATE_DIR="$TMP_DIR"
  export LAC_ACCEPT_KEY="right-arrow"
  source "$ROOT_DIR/zsh/llm-cli-suggestions.zsh"

  tab_binding="$(bindkey "^I")"
  [[ "$tab_binding" != *"lac-accept-or-complete"* ]] || {
    print -u2 -- "expected Tab to keep native completion when right-arrow is selected, got: $tab_binding"
    return 1
  }

  for right_seq in "${terminfo[kcuf1]}" "$(printf "\\033[C")" "$(printf "\\033OC")"; do
    [[ -n "$right_seq" ]] || continue
    right_binding="$(bindkey "$right_seq" 2>/dev/null)"
    [[ "$right_binding" == *"lac-accept-or-forward-char"* ]] || {
      print -u2 -- "expected Right Arrow sequence to be bound to lac-accept-or-forward-char, got: $right_binding"
      return 1
    }
  done

  LAC_SUGGESTION="git status"
  BUFFER="git st"
  CURSOR=${#BUFFER}
  function zle() {
    LAST_WIDGET="$1"
    return 0
  }

  lac-accept-or-forward-char
  [[ "$BUFFER" == "git status" ]] || {
    print -u2 -- "expected Right Arrow accept widget to populate buffer, got: $BUFFER"
    return 1
  }

  LAC_SUGGESTION=""
  BUFFER="git status"
  CURSOR=3
  LAST_WIDGET=""
  lac-accept-or-forward-char
  [[ "$LAST_WIDGET" == "forward-char" ]] || {
    print -u2 -- "expected Right Arrow fallback to call forward-char, got: $LAST_WIDGET"
    return 1
  }
'


cat >"$TMP_DIR/runtime.env" <<EOF
LAC_MODEL_NAME="$MODEL_NAME"
LAC_MODEL_BASE_URL="http://127.0.0.1:11434"
LAC_SUGGEST_STRATEGY="history+model"
LAC_SOCKET_PATH="$SOCKET_PATH"
LAC_DB_PATH="$DB_PATH"
LAC_SUGGEST_TIMEOUT_MS="1200"
LAC_PTY_CAPTURE_MODE="blocklist"
LAC_PTY_CAPTURE_ALLOWLIST=""
LAC_PTY_CAPTURE_BLOCKLIST=$'uname\n/^git branch --no-color$/'
EOF

script -q /dev/null zsh -dfi -c '
  export LAC_CLIENT_BIN="$ROOT_DIR/bin/autocomplete-client"
  export LAC_DAEMON_BIN="$ROOT_DIR/bin/autocomplete-daemon"
  export LAC_SOCKET_PATH="$SOCKET_PATH"
  export LAC_STATE_DIR="$TMP_DIR"
  source "$ROOT_DIR/zsh/llm-cli-suggestions.zsh"

  lac-start-daemon

  (( ! $+functions[uname] )) || {
    print -u2 -- "expected uname to remain unwrapped in blocklist mode"
    return 1
  }

  _lac_preexec "whoami"
  (( $+functions[whoami] )) || {
    print -u2 -- "expected whoami PTY wrapper to be installed lazily in blocklist mode"
    return 1
  }
  whoami
  _lac_precmd
  sleep 0.3

  _lac_preexec "FOO=1 git branch --no-color"
  (( $+functions[git] )) || {
    print -u2 -- "expected git PTY wrapper to be installed lazily in blocklist mode"
    return 1
  }
  FOO=1 git branch --no-color
  _lac_precmd
  sleep 0.3

  _lac_preexec "git branch --no-color"
  git branch --no-color
  _lac_precmd
  sleep 0.3

  _lac_preexec "uname -m"
  uname -m
  _lac_precmd
  sleep 0.3
'

commands_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text in ('git status','git stash','npm run','npm run dev');")"
accepted_count="$(sqlite3 "$DB_PATH" "select count(*) from feedback_events where event_type = 'accepted' and accepted_command = 'git status';")"
rejected_count="$(sqlite3 "$DB_PATH" "select count(*) from feedback_events where event_type = 'rejected' and actual_command = 'git stash';")"
suggestions_count="$(sqlite3 "$DB_PATH" "select count(*) from suggestions where suggestion_text = 'git status';")"
stdout_capture_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text like 'printf%' and stdout_excerpt like '%hello%';")"
plain_uncaptured_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text = 'printf hello-plain' and stdout_excerpt = '' and stderr_excerpt = '';")"
pty_stdout_capture_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text = 'uname -s' and stdout_excerpt like '%Darwin%';")"
stderr_redirect_capture_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text = 'uname -r 2>/dev/null' and stdout_excerpt <> '' and stderr_excerpt = '';")"
allowlist_regex_uncaptured_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text = 'uname -m' and stdout_excerpt = '' and stderr_excerpt = '';")"
skipped_redirect_capture_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text like 'printf skipped >%' and stdout_excerpt = '' and stderr_excerpt = '';")"
blocklist_pty_capture_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text = 'whoami' and stdout_excerpt <> '';")"
prefixed_git_branch_pty_capture_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text = 'FOO=1 git branch --no-color' and stdout_excerpt like '%main%';")"
regex_blocklisted_git_branch_uncaptured_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text = 'git branch --no-color' and stdout_excerpt = '' and stderr_excerpt = '';")"
blocklisted_uncaptured_count="$(sqlite3 "$DB_PATH" "select count(*) from commands where command_text = 'uname -m' and stdout_excerpt = '' and stderr_excerpt = '';")"

trimmed_capture_test="$(ROOT_DIR_ENV="$ROOT_DIR" zsh -dfi -c 'source "$ROOT_DIR_ENV"/zsh/llm-cli-suggestions.zsh; export LAC_CAPTURE_HEAD_BYTES=5; export LAC_CAPTURE_TAIL_BYTES=6; sample=abcdefghijklmnopqrstuvwxyz; trimmed=$(_lac_trim_capture "$sample"); print -r -- "$trimmed"' )"
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

[[ "$stderr_redirect_capture_count" -ge 1 ]] || {
  echo "expected bounded output capture when only stderr is redirected, got $stderr_redirect_capture_count" >&2
  exit 1
}

[[ "$allowlist_regex_uncaptured_count" -ge 1 ]] || {
  echo "expected allowlist regex to leave uname -m uncaptured, got $allowlist_regex_uncaptured_count" >&2
  exit 1
}

[[ "$blocklist_pty_capture_count" -ge 1 ]] || {
  echo "expected PTY output capture for whoami in blocklist mode, got $blocklist_pty_capture_count" >&2
  exit 1
}

[[ "$regex_blocklisted_git_branch_uncaptured_count" -ge 1 ]] || {
  echo "expected regex-blocklisted git branch command to remain uncaptured, got $regex_blocklisted_git_branch_uncaptured_count" >&2
  exit 1
}

[[ "$prefixed_git_branch_pty_capture_count" -ge 1 ]] || {
  echo "expected PTY output capture for prefixed git branch in blocklist mode, got $prefixed_git_branch_pty_capture_count" >&2
  exit 1
}

[[ "$blocklisted_uncaptured_count" -ge 1 ]] || {
  echo "expected blocklisted uname -m command to remain uncaptured, got $blocklisted_uncaptured_count" >&2
  exit 1
}

[[ "$skipped_redirect_capture_count" -ge 1 ]] || {
  echo "expected skipped capture for redirected printf command, got $skipped_redirect_capture_count" >&2
  exit 1
}

[[ "$trimmed_capture_test" == $'abcde\n...\nuvwxyz' ]] || {
  echo "expected trimmed capture to keep the configured head and tail bytes, got: $trimmed_capture_test" >&2
  exit 1
}

echo "shell smoke test passed"
echo "commands=$commands_count suggestions=$suggestions_count accepted=$accepted_count rejected=$rejected_count output_captured=$stdout_capture_count plain_uncaptured=$plain_uncaptured_count pty_output_captured=$pty_stdout_capture_count stderr_redirect_output_captured=$stderr_redirect_capture_count blocklist_output_captured=$blocklist_pty_capture_count prefixed_git_branch_output_captured=$prefixed_git_branch_pty_capture_count regex_blocklisted_git_branch_uncaptured=$regex_blocklisted_git_branch_uncaptured_count blocklisted_uncaptured=$blocklisted_uncaptured_count skipped_redirect_capture=$skipped_redirect_capture_count"
