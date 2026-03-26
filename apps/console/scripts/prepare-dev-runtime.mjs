#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const binDir = path.join(repoRoot, "bin");
const defaultStateDir = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "llm-cli-suggestions",
);
const stateDir = process.env.LAC_STATE_DIR || defaultStateDir;
const runtimeEnvPath = path.join(stateDir, "runtime.env");

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (label) {
    console.log(`[predev] ${label}`);
  }
}

function runShell(script) {
  const result = spawnSync("/bin/zsh", ["-lc", script], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      REPO_ROOT: repoRoot,
      STATE_DIR: stateDir,
      RUNTIME_ENV_PATH: runtimeEnvPath,
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[predev] rebuilding Go binaries...");
run("go", ["build", "-o", path.join(binDir, "autocomplete-daemon"), "./cmd/autocomplete-daemon"]);
run("go", ["build", "-o", path.join(binDir, "autocomplete-client"), "./cmd/autocomplete-client"]);
run("go", ["build", "-o", path.join(binDir, "model-bench"), "./cmd/model-bench"]);

console.log("[predev] restarting autocomplete daemon...");
runShell(`
set -e
mkdir -p "$STATE_DIR" "$STATE_DIR/benchmarks"

if [ -f "$RUNTIME_ENV_PATH" ]; then
  source "$RUNTIME_ENV_PATH"
fi

: "\${LAC_SOCKET_PATH:=$STATE_DIR/daemon.sock}"
: "\${LAC_DB_PATH:=$STATE_DIR/autocomplete.sqlite}"
: "\${LAC_MODEL_NAME:=qwen2.5-coder:7b}"
: "\${LAC_MODEL_BASE_URL:=http://127.0.0.1:11434}"
: "\${LAC_SUGGEST_STRATEGY:=history+model}"

PID_FILE="$STATE_DIR/daemon.pid"
LOG_FILE="$STATE_DIR/daemon.log"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
    sleep 1
    kill -9 "$PID" 2>/dev/null || true
  fi
fi

rm -f "$LAC_SOCKET_PATH"

nohup "$REPO_ROOT/bin/autocomplete-daemon" \
  --socket "$LAC_SOCKET_PATH" \
  --db "$LAC_DB_PATH" \
  --model "$LAC_MODEL_NAME" \
  --strategy "$LAC_SUGGEST_STRATEGY" \
  --model-url "$LAC_MODEL_BASE_URL" \
  >> "$LOG_FILE" 2>&1 &

NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"
sleep 1

if ! kill -0 "$NEW_PID" 2>/dev/null; then
  echo "[predev] daemon failed to start" >&2
  exit 1
fi

echo "[predev] daemon pid $NEW_PID listening on $LAC_SOCKET_PATH"
`);
