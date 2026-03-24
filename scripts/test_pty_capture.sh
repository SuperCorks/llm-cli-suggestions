#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lac-pty.XXXXXX")"
STATE_DIR="$TMP_DIR/state"
WORK_DIR="$TMP_DIR/workdir"
SOCKET_PATH="$STATE_DIR/daemon.sock"
DB_PATH="$STATE_DIR/autocomplete.sqlite"
LOG_PATH="$STATE_DIR/daemon.log"
SESSION_LOG="$TMP_DIR/session.log"
MODEL_NAME="${LAC_PTY_TEST_MODEL:-llama3.2:latest}"
DAEMON_PID=""

cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    kill "$DAEMON_PID" >/dev/null 2>&1 || true
    wait "$DAEMON_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "expected '$command_name' to be available" >&2
    exit 1
  }
}

require_command expect
require_command sqlite3

mkdir -p "$ROOT_DIR/bin" "$STATE_DIR/async" "$WORK_DIR"
cat >"$WORK_DIR/emit-stdout-stderr" <<'EOF'
#!/usr/bin/env bash
printf 'pty-out\n'
printf 'pty-err\n' >&2
EOF
chmod +x "$WORK_DIR/emit-stdout-stderr"

if [[ ! -x "$ROOT_DIR/bin/autocomplete-daemon" || ! -x "$ROOT_DIR/bin/autocomplete-client" ]]; then
  make -C "$ROOT_DIR" build >/dev/null
fi

LAC_STATE_DIR="$STATE_DIR" \
LAC_SOCKET_PATH="$SOCKET_PATH" \
LAC_DB_PATH="$DB_PATH" \
LAC_MODEL_NAME="$MODEL_NAME" \
"$ROOT_DIR/bin/autocomplete-daemon" \
  --socket "$SOCKET_PATH" \
  --db "$DB_PATH" \
  --model "$MODEL_NAME" \
  --strategy history-only >"$LOG_PATH" 2>&1 &
DAEMON_PID=$!

for _ in $(seq 1 20); do
  if LAC_SOCKET_PATH="$SOCKET_PATH" "$ROOT_DIR/bin/autocomplete-client" health >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

LAC_SOCKET_PATH="$SOCKET_PATH" "$ROOT_DIR/bin/autocomplete-client" health >/dev/null

cat >"$STATE_DIR/runtime.env" <<EOF
LAC_MODEL_NAME="$MODEL_NAME"
LAC_MODEL_BASE_URL="http://127.0.0.1:11434"
LAC_SUGGEST_STRATEGY="history-only"
LAC_SOCKET_PATH="$SOCKET_PATH"
LAC_DB_PATH="$DB_PATH"
LAC_SUGGEST_TIMEOUT_MS="1200"
LAC_PTY_CAPTURE_MODE="allowlist"
LAC_PTY_CAPTURE_ALLOWLIST="emit-stdout-stderr"
LAC_PTY_CAPTURE_BLOCKLIST=""
EOF

export ROOT_DIR TMP_DIR STATE_DIR WORK_DIR SOCKET_PATH DB_PATH SESSION_LOG
expect <<'EOF'
set timeout 15
log_user 0
log_file -noappend $env(SESSION_LOG)

spawn env \
  HOME=$env(TMP_DIR) \
  TERM=xterm-256color \
  LAC_STATE_DIR=$env(STATE_DIR) \
  LAC_ASYNC_DIR=$env(STATE_DIR)/async \
  LAC_SOCKET_PATH=$env(SOCKET_PATH) \
  LAC_DB_PATH=$env(DB_PATH) \
  LAC_CLIENT_BIN=$env(ROOT_DIR)/bin/autocomplete-client \
  LAC_DAEMON_BIN=$env(ROOT_DIR)/bin/autocomplete-daemon \
  PATH=$env(WORK_DIR):$env(PATH) \
  zsh -dfi

expect "% "
send -- "PROMPT='> '; RPROMPT=''; export PATH='$env(WORK_DIR)':\"\$PATH\"; cd '$env(WORK_DIR)'; source '$env(ROOT_DIR)/zsh/llm-cli-suggestions.zsh'\r"
expect "> "
send -- "emit-stdout-stderr 2>/dev/null\r"
expect "> "
send -- "sleep 0.3\r"
expect "> "
send -- "exit\r"
expect eof
EOF

captured_stdout_len="$(sqlite3 "$DB_PATH" "select coalesce(length(stdout_excerpt), 0) from commands where command_text = 'emit-stdout-stderr 2>/dev/null' order by id desc limit 1;")"
captured_stderr_len="$(sqlite3 "$DB_PATH" "select coalesce(length(stderr_excerpt), 0) from commands where command_text = 'emit-stdout-stderr 2>/dev/null' order by id desc limit 1;")"
captured_stdout_text="$(sqlite3 "$DB_PATH" "select coalesce(stdout_excerpt, '') from commands where command_text = 'emit-stdout-stderr 2>/dev/null' order by id desc limit 1;")"

[[ -n "$captured_stdout_len" && "$captured_stdout_len" -gt 0 ]] || {
  echo "expected first-use capture with stderr-only redirection to record stdout, got stdout_len=$captured_stdout_len stderr_len=$captured_stderr_len" >&2
  exit 1
}

[[ "$captured_stderr_len" == "0" ]] || {
  echo "expected stderr-only redirection to keep stderr out of captured excerpts, got stdout_len=$captured_stdout_len stderr_len=$captured_stderr_len" >&2
  exit 1
}

[[ "$captured_stdout_text" == *"pty-out"* && "$captured_stdout_text" != *"pty-err"* ]] || {
  echo "expected captured stdout to include only stdout content, got: $captured_stdout_text" >&2
  exit 1
}

if grep -q "pty-err" "$SESSION_LOG"; then
  echo "expected stderr-only redirection to suppress stderr from terminal output" >&2
  exit 1
fi

echo "pty capture regression test passed"
echo "stderr_redirect_stdout_len=$captured_stdout_len stderr_len=$captured_stderr_len"