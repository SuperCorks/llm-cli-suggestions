import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const stateDir = process.env.LAC_STATE_DIR;
const dbPath = process.env.LAC_DB_PATH;

if (!stateDir || !dbPath) {
  throw new Error("LAC_STATE_DIR and LAC_DB_PATH must be set for e2e seeding.");
}

fs.rmSync(stateDir, { recursive: true, force: true });
fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(path.join(stateDir, "benchmarks"), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    created_at_ms INTEGER NOT NULL
  );

  CREATE TABLE commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    command_text TEXT NOT NULL,
    cwd TEXT NOT NULL,
    repo_root TEXT NOT NULL,
    branch TEXT NOT NULL,
    exit_code INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    started_at_ms INTEGER NOT NULL,
    finished_at_ms INTEGER NOT NULL,
    stdout_excerpt TEXT NOT NULL DEFAULT '',
    stderr_excerpt TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    buffer TEXT NOT NULL,
    suggestion_text TEXT NOT NULL,
    source TEXT NOT NULL,
    cwd TEXT NOT NULL,
    repo_root TEXT NOT NULL,
    branch TEXT NOT NULL,
    last_exit_code INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    model_name TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
  );

  CREATE TABLE feedback_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    buffer TEXT NOT NULL,
    suggestion_text TEXT NOT NULL,
    accepted_command TEXT NOT NULL,
    actual_command TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
  );

  CREATE TABLE benchmark_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    models TEXT NOT NULL,
    repeat_count INTEGER NOT NULL,
    timeout_ms INTEGER NOT NULL,
    output_json_path TEXT NOT NULL,
    summary_json TEXT NOT NULL DEFAULT '',
    error_text TEXT NOT NULL DEFAULT '',
    created_at_ms INTEGER NOT NULL,
    started_at_ms INTEGER NOT NULL DEFAULT 0,
    finished_at_ms INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE benchmark_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    model_name TEXT NOT NULL,
    case_name TEXT NOT NULL,
    run_number INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    suggestion_text TEXT NOT NULL,
    valid_prefix INTEGER NOT NULL,
    accepted INTEGER NOT NULL,
    error_text TEXT NOT NULL DEFAULT '',
    created_at_ms INTEGER NOT NULL
  );
`);

const now = Date.now();
const repoRoot = "/Users/simon/projects/gleamery";
const cwd = `${repoRoot}/apps/console`;
const sessionId = "session-alpha";

db.prepare("INSERT INTO sessions(id, created_at_ms) VALUES (?, ?)").run(sessionId, now - 300_000);

const insertCommand = db.prepare(`
  INSERT INTO commands(
    session_id, command_text, cwd, repo_root, branch, exit_code, duration_ms,
    started_at_ms, finished_at_ms, stdout_excerpt, stderr_excerpt
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

insertCommand.run(
  sessionId,
  "git status",
  cwd,
  repoRoot,
  "main",
  0,
  38,
  now - 250_000,
  now - 249_962,
  "On branch main",
  "",
);
insertCommand.run(
  sessionId,
  "npm run dev",
  cwd,
  repoRoot,
  "main",
  0,
  162,
  now - 220_000,
  now - 219_838,
  "Next.js ready on http://localhost:3000",
  "",
);
insertCommand.run(
  sessionId,
  'git commit -m "ship console"',
  cwd,
  repoRoot,
  "main",
  0,
  54,
  now - 180_000,
  now - 179_946,
  "[main abc123] ship console",
  "",
);
insertCommand.run(
  sessionId,
  "npm run build",
  cwd,
  repoRoot,
  "main",
  1,
  122,
  now - 140_000,
  now - 139_878,
  "",
  "Build failed in seeded fixture",
);

const insertSuggestion = db.prepare(`
  INSERT INTO suggestions(
    session_id, buffer, suggestion_text, source, cwd, repo_root, branch,
    last_exit_code, latency_ms, model_name, created_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const acceptedSuggestion = insertSuggestion.run(
  sessionId,
  "git st",
  "git status",
  "history+model",
  cwd,
  repoRoot,
  "main",
  0,
  143,
  "qwen2.5-coder:7b",
  now - 110_000,
);
const rejectedSuggestion = insertSuggestion.run(
  sessionId,
  "npm run b",
  "npm run build",
  "model",
  cwd,
  repoRoot,
  "main",
  0,
  286,
  "qwen2.5-coder:7b",
  now - 90_000,
);
insertSuggestion.run(
  sessionId,
  "git commit -m",
  'git commit -m "ship console"',
  "history",
  cwd,
  repoRoot,
  "main",
  0,
  62,
  "qwen2.5-coder:7b",
  now - 70_000,
);

const insertFeedback = db.prepare(`
  INSERT INTO feedback_events(
    suggestion_id, session_id, event_type, buffer, suggestion_text,
    accepted_command, actual_command, created_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

insertFeedback.run(
  Number(acceptedSuggestion.lastInsertRowid),
  sessionId,
  "accepted",
  "git st",
  "git status",
  "git status",
  "",
  now - 108_000,
);
insertFeedback.run(
  Number(rejectedSuggestion.lastInsertRowid),
  sessionId,
  "rejected",
  "npm run b",
  "npm run build",
  "",
  "npm run test",
  now - 88_000,
);

const summaryJson = JSON.stringify({
  "qwen2.5-coder:7b": {
    avgLatencyMs: 186,
    accepted: 3,
    validPrefix: 4,
  },
});

const benchmarkRun = db
  .prepare(`
    INSERT INTO benchmark_runs(
      status, models, repeat_count, timeout_ms, output_json_path, summary_json,
      error_text, created_at_ms, started_at_ms, finished_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  .run(
    "completed",
    "qwen2.5-coder:7b",
    2,
    5000,
    path.join(stateDir, "benchmarks", "run-1.json"),
    summaryJson,
    "",
    now - 60_000,
    now - 59_000,
    now - 55_000,
  );

const runId = Number(benchmarkRun.lastInsertRowid);
const insertBenchmarkResult = db.prepare(`
  INSERT INTO benchmark_results(
    run_id, model_name, case_name, run_number, latency_ms, suggestion_text,
    valid_prefix, accepted, error_text, created_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

insertBenchmarkResult.run(
  runId,
  "qwen2.5-coder:7b",
  "git status prompt",
  1,
  172,
  "git status",
  1,
  1,
  "",
  now - 58_000,
);
insertBenchmarkResult.run(
  runId,
  "qwen2.5-coder:7b",
  "build prompt",
  2,
  201,
  "npm run build",
  1,
  0,
  "",
  now - 57_000,
);

db.close();

fs.writeFileSync(
  path.join(stateDir, "runtime.env"),
  [
    'LAC_MODEL_NAME="qwen2.5-coder:7b"',
    'LAC_MODEL_BASE_URL="http://127.0.0.1:11434"',
    `LAC_SOCKET_PATH="${path.join(stateDir, "daemon.sock")}"`,
    `LAC_DB_PATH="${dbPath}"`,
    'LAC_SUGGEST_TIMEOUT_MS="900"',
    "",
  ].join("\n"),
  "utf8",
);

fs.writeFileSync(
  path.join(stateDir, "daemon.log"),
  [
    "[INFO] Model warmed up in 146ms",
    "[INFO] Suggestions persisted to sqlite",
    "[WARN] Benchmark fixture loaded without live daemon",
    "[INFO] Control app smoke environment ready",
    "",
  ].join("\n"),
  "utf8",
);

fs.writeFileSync(path.join(stateDir, "daemon.pid"), "4242\n", "utf8");
