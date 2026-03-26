#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lac-ghost.XXXXXX")"
STATE_DIR="$TMP_DIR/state"
WORK_DIR="$TMP_DIR/workdir"
SOCKET_PATH="$STATE_DIR/daemon.sock"
DB_PATH="$STATE_DIR/autocomplete.sqlite"
SNAPSHOT_PATH="$STATE_DIR/ghost-snapshots.tsv"
LOG_PATH="$STATE_DIR/daemon.log"
MODEL_NAME="${LAC_GHOST_MODEL:-llama3.2:latest}"
WAIT_MS="${LAC_GHOST_WAIT_MS:-2000}"
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
require_command python3

mkdir -p "$ROOT_DIR/bin" "$STATE_DIR/async" "$WORK_DIR"

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

now_ms="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"

"$ROOT_DIR/bin/autocomplete-client" record-command \
  --socket "$SOCKET_PATH" \
  --session seed-session \
  --command "npm prune" \
  --cwd "$WORK_DIR" \
  --repo-root "" \
  --branch "" \
  --exit-code 0 \
  --duration-ms 120 \
  --started-at-ms "$(( now_ms - 120 ))" \
  --finished-at-ms "$now_ms"

sleep 0.2

export ROOT_DIR TMP_DIR STATE_DIR WORK_DIR SOCKET_PATH DB_PATH SNAPSHOT_PATH
export WAIT_MS

expect_marker() {
  local strategy="$1"
  local source="$2"
  local stage_role="$3"
  local expected="$4"
  local actual

  actual="$(
    HOME="$TMP_DIR" \
    LAC_STATE_DIR="$STATE_DIR" \
    LAC_ASYNC_DIR="$STATE_DIR/async" \
    LAC_SOCKET_PATH="$SOCKET_PATH" \
    LAC_DB_PATH="$DB_PATH" \
    LAC_CLIENT_BIN="$ROOT_DIR/bin/autocomplete-client" \
    LAC_DAEMON_BIN="$ROOT_DIR/bin/autocomplete-daemon" \
    LAC_SUGGEST_STRATEGY="$strategy" \
    zsh -dfc "source '$ROOT_DIR/zsh/llm-cli-suggestions.zsh'; _lac_format_suggestion_source_marker '$source' '$stage_role'"
  )"

  if [[ "$actual" != "$expected" ]]; then
    echo "expected marker $expected for strategy=$strategy source=$source stage_role=$stage_role, got $actual" >&2
    exit 1
  fi
}

expect_marker "model-only" "model" "" " [ai]"
expect_marker "history-then-fast-then-model" "model" "fast" " [ai/fast]"
expect_marker "history-then-fast-then-model" "model" "slow" " [ai/slow]"
expect_marker "fast-then-model" "history+model" "slow" " [history+ai/slow]"
expect_marker "history-only" "history" "" " [history]"

run_idle_prefix() {
  local prefix="$1"
  local snapshot_path="$2"

  rm -f "$snapshot_path"

  ROOT_DIR="$ROOT_DIR" \
  TMP_DIR="$TMP_DIR" \
  STATE_DIR="$STATE_DIR" \
  WORK_DIR="$WORK_DIR" \
  SOCKET_PATH="$SOCKET_PATH" \
  DB_PATH="$DB_PATH" \
  SNAPSHOT_PATH="$snapshot_path" \
  LAC_TEST_PREFIX="$prefix" \
  WAIT_MS="$WAIT_MS" \
  expect <<'EOF'
set timeout 15
log_user 0

spawn env \
  HOME=$env(TMP_DIR) \
  TERM=xterm-256color \
  LAC_STATE_DIR=$env(STATE_DIR) \
  LAC_ASYNC_DIR=$env(STATE_DIR)/async \
  LAC_SOCKET_PATH=$env(SOCKET_PATH) \
  LAC_DB_PATH=$env(DB_PATH) \
  LAC_CLIENT_BIN=$env(ROOT_DIR)/bin/autocomplete-client \
  LAC_DAEMON_BIN=$env(ROOT_DIR)/bin/autocomplete-daemon \
  LAC_SUGGEST_STRATEGY=history-only \
  LAC_SNAPSHOT_PATH=$env(SNAPSHOT_PATH) \
  zsh -dfi

set shell_pid [exp_pid]
after 200
send -- "PROMPT='> '; RPROMPT=''; cd '$env(WORK_DIR)'; source '$env(ROOT_DIR)/zsh/llm-cli-suggestions.zsh'\r"
expect "> "
send -- $env(LAC_TEST_PREFIX)

set deadline [expr {[clock milliseconds] + $env(WAIT_MS)}]
set applied 0
while {$applied == 0 && [clock milliseconds] < $deadline} {
  if {[file exists $env(SNAPSHOT_PATH)]} {
    set snapshot_handle [open $env(SNAPSHOT_PATH) r]
    set snapshot_text [read $snapshot_handle]
    close $snapshot_handle
    if {[string first "notify-applied:" $snapshot_text] >= 0} {
      set applied 1
      break
    }
  }
  after 50
}

after 100
exec kill -TERM $shell_pid
expect eof
EOF
}

EXPECTED_JSON_PATH="$(
  ROOT_DIR="$ROOT_DIR" \
  SOCKET_PATH="$SOCKET_PATH" \
  WORK_DIR="$WORK_DIR" \
  STATE_DIR="$STATE_DIR" \
  python3 - <<'PY'
from pathlib import Path
import json
import os
import subprocess
import sys

root_dir = Path(os.environ["ROOT_DIR"])
client_bin = root_dir / "bin" / "autocomplete-client"
socket_path = os.environ["SOCKET_PATH"]
work_dir = os.environ["WORK_DIR"]
state_dir = Path(os.environ["STATE_DIR"])
prefixes = ["n", "npm ", "npm p", "npm pr"]

expected = {}

def format_source_marker(source: str) -> str:
    labels = []
    for tag in source.split("+"):
        if tag == "history":
            label = "history"
        elif tag == "model":
            label = "ai"
        elif tag:
            label = "ranking"
        else:
            continue

        if label not in labels:
            labels.append(label)

    if not labels:
        return ""

    return " [" + "+".join(labels) + "]"

for index, prefix in enumerate(prefixes, start=1):
    result = subprocess.run(
        [
            str(client_bin),
            "suggest",
            "--socket",
            socket_path,
            "--session",
            f"ghost-probe-{index}",
            "--buffer",
            prefix,
            "--cwd",
            work_dir,
            "--repo-root",
            "",
            "--branch",
            "",
            "--last-exit",
            "0",
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    line = result.stdout.strip()
    parts = line.split("\t", 2)
    suggestion = parts[1] if len(parts) >= 2 else ""
    source = parts[2] if len(parts) >= 3 else ""
    if not suggestion or suggestion == prefix or not suggestion.startswith(prefix):
        print(
            f"expected a usable direct suggestion for {prefix!r}, got {line!r}",
            file=sys.stderr,
        )
        sys.exit(1)

    expected[prefix] = {
      "postdisplay": suggestion[len(prefix):] + format_source_marker(source),
        "suggestion": suggestion,
      "source": source,
    }

matrix_path = state_dir / "ghost-expected.json"
matrix_path.write_text(json.dumps(expected), encoding="utf-8")
print(matrix_path)
PY
)"

printf '%s\n' "$EXPECTED_JSON_PATH"
while IFS= read -r prefix; do
  snapshot_file="$(python3 - "$STATE_DIR" "$prefix" <<'PY'
from pathlib import Path
import hashlib
import sys

state_dir = Path(sys.argv[1])
prefix = sys.argv[2]
digest = hashlib.sha1(prefix.encode("utf-8")).hexdigest()[:10]
print(state_dir / f"ghost-{digest}.tsv")
PY
)"

  run_idle_prefix "$prefix" "$snapshot_file"

  SNAPSHOT_FILE="$snapshot_file" \
  PREFIX_VALUE="$prefix" \
  EXPECTED_JSON_PATH="$EXPECTED_JSON_PATH" \
  python3 - <<'PY'
from pathlib import Path
import csv
import json
import os
import sys

snapshot_path = Path(os.environ["SNAPSHOT_FILE"])
prefix = os.environ["PREFIX_VALUE"]
expected = json.loads(Path(os.environ["EXPECTED_JSON_PATH"]).read_text(encoding="utf-8"))
direct_suggestion = expected[prefix]["suggestion"]

def format_source_marker(source: str) -> str:
  labels = []
  for tag in source.split("+"):
    if tag == "history":
      label = "history"
    elif tag == "model":
      label = "ai"
    elif tag:
      label = "ranking"
    else:
      continue

    if label not in labels:
      labels.append(label)

  if not labels:
    return ""

  return " [" + "+".join(labels) + "]"

if not snapshot_path.exists():
    print(f"expected snapshot file for {prefix!r}", file=sys.stderr)
    sys.exit(1)

rows = []
with snapshot_path.open("r", encoding="utf-8") as handle:
    reader = csv.reader(handle, delimiter="\t")
    for row in reader:
        if len(row) != 8:
            continue
        rows.append(
            {
                "event": row[0],
                "buffer": row[1],
                "postdisplay": row[2],
                "suggestion": row[3],
                "source": row[4],
                "cursor": row[5],
                "async_ready": row[6],
                "request_seq": row[7],
            }
        )

matching = [row for row in rows if row["buffer"] == prefix]
matched_state = next(
    (
        row
        for row in matching
        if row["event"].startswith("notify-applied:")
        and row["suggestion"].startswith(prefix)
        and row["suggestion"] != prefix
        and row["postdisplay"] == row["suggestion"][len(prefix):] + format_source_marker(row["source"])
    ),
    None,
)

if matched_state is None:
    print(
        f"missing rendered ghost-text state for buffer {prefix!r}: direct probe suggested {direct_suggestion!r}",
        file=sys.stderr,
    )
    for row in matching[-8:]:
        print(f"  observed={row}", file=sys.stderr)
    sys.exit(1)

print(
  f"{prefix!r}\tdirect={direct_suggestion!r}\trendered={matched_state['suggestion']!r}\tpostdisplay={matched_state['postdisplay']!r}\tsource={matched_state['source']!r}\tevent={matched_state['event']}"
)
PY
done < <(python3 - "$EXPECTED_JSON_PATH" <<'PY'
from pathlib import Path
import json
import sys

expected = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
for prefix in expected:
    print(prefix)
PY
)

echo "ghost text timing test passed"
