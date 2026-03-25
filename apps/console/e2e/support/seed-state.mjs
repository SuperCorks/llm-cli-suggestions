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
    request_latency_ms INTEGER NOT NULL DEFAULT -1,
    model_name TEXT NOT NULL,
    request_model_name TEXT NOT NULL DEFAULT '',
    model_total_duration_ms INTEGER NOT NULL DEFAULT -1,
    model_load_duration_ms INTEGER NOT NULL DEFAULT -1,
    model_prompt_eval_duration_ms INTEGER NOT NULL DEFAULT -1,
    model_eval_duration_ms INTEGER NOT NULL DEFAULT -1,
    model_prompt_eval_count INTEGER NOT NULL DEFAULT -1,
    model_eval_count INTEGER NOT NULL DEFAULT -1,
    prompt_text TEXT NOT NULL DEFAULT '',
    structured_context_json TEXT NOT NULL DEFAULT '',
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

  CREATE TABLE suggestion_reviews (
    suggestion_id INTEGER PRIMARY KEY,
    review_label TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
  );

  CREATE TABLE benchmark_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    track TEXT NOT NULL,
    surface TEXT NOT NULL,
    suite_name TEXT NOT NULL,
    strategy TEXT NOT NULL,
    timing_protocol TEXT NOT NULL,
    models TEXT NOT NULL,
    repeat_count INTEGER NOT NULL,
    timeout_ms INTEGER NOT NULL,
    filters_json TEXT NOT NULL DEFAULT '',
    dataset_size INTEGER NOT NULL DEFAULT 0,
    environment_json TEXT NOT NULL DEFAULT '',
    output_json_path TEXT NOT NULL,
    summary_json TEXT NOT NULL DEFAULT '',
    log_text TEXT NOT NULL DEFAULT '',
    last_event_at_ms INTEGER NOT NULL DEFAULT 0,
    error_text TEXT NOT NULL DEFAULT '',
    created_at_ms INTEGER NOT NULL,
    started_at_ms INTEGER NOT NULL DEFAULT 0,
    finished_at_ms INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE benchmark_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    model_name TEXT NOT NULL,
    track TEXT NOT NULL,
    surface TEXT NOT NULL,
    suite_name TEXT NOT NULL,
    strategy TEXT NOT NULL,
    timing_protocol TEXT NOT NULL,
    timing_phase TEXT NOT NULL,
    start_state TEXT NOT NULL,
    case_id TEXT NOT NULL,
    case_name TEXT NOT NULL,
    category TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '',
    label_kind TEXT NOT NULL,
    run_number INTEGER NOT NULL,
    request_json TEXT NOT NULL DEFAULT '',
    expected_command TEXT NOT NULL DEFAULT '',
    expected_alternatives_json TEXT NOT NULL DEFAULT '',
    negative_target TEXT NOT NULL DEFAULT '',
    winner_command TEXT NOT NULL DEFAULT '',
    winner_source TEXT NOT NULL DEFAULT '',
    candidates_json TEXT NOT NULL DEFAULT '',
    raw_model_output TEXT NOT NULL DEFAULT '',
    cleaned_model_output TEXT NOT NULL DEFAULT '',
    exact_match INTEGER NOT NULL DEFAULT 0,
    alternative_match INTEGER NOT NULL DEFAULT 0,
    negative_avoided INTEGER NOT NULL DEFAULT 0,
    valid_prefix INTEGER NOT NULL DEFAULT 0,
    candidate_hit_at_3 INTEGER NOT NULL DEFAULT 0,
    chars_saved_ratio REAL NOT NULL DEFAULT 0,
    command_edit_distance INTEGER NOT NULL DEFAULT 0,
    request_latency_ms INTEGER NOT NULL DEFAULT 0,
    model_total_duration_ms INTEGER NOT NULL DEFAULT 0,
    model_load_duration_ms INTEGER NOT NULL DEFAULT 0,
    model_prompt_eval_duration_ms INTEGER NOT NULL DEFAULT 0,
    model_eval_duration_ms INTEGER NOT NULL DEFAULT 0,
    model_prompt_eval_count INTEGER NOT NULL DEFAULT 0,
    model_eval_count INTEGER NOT NULL DEFAULT 0,
    decode_tokens_per_second REAL NOT NULL DEFAULT 0,
    non_model_overhead_duration_ms INTEGER NOT NULL DEFAULT 0,
    model_error TEXT NOT NULL DEFAULT '',
    error_text TEXT NOT NULL DEFAULT '',
    replay_source_json TEXT NOT NULL DEFAULT '',
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
    last_exit_code, latency_ms, request_latency_ms, model_name, request_model_name,
    model_total_duration_ms, model_load_duration_ms, model_prompt_eval_duration_ms,
    model_eval_duration_ms, model_prompt_eval_count, model_eval_count, created_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  178,
  "qwen2.5-coder:7b",
  "qwen2.5-coder:7b",
  171,
  0,
  46,
  92,
  42,
  19,
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
  332,
  "qwen2.5-coder:7b",
  "qwen2.5-coder:7b",
  304,
  118,
  71,
  115,
  58,
  25,
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
  62,
  "qwen2.5-coder:7b",
  "",
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  now - 70_000,
);
insertSuggestion.run(
  sessionId,
  "",
  "fixture empty buffer suggestion",
  "model",
  cwd,
  repoRoot,
  "main",
  0,
  51,
  51,
  "qwen2.5-coder:7b",
  "qwen2.5-coder:7b",
  49,
  0,
  16,
  18,
  14,
  8,
  now - 65_000,
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

db.prepare(
  "INSERT INTO suggestion_reviews(suggestion_id, review_label, updated_at_ms) VALUES (?, ?, ?)",
).run(Number(acceptedSuggestion.lastInsertRowid), "good", now - 107_000);
db.prepare(
  "INSERT INTO suggestion_reviews(suggestion_id, review_label, updated_at_ms) VALUES (?, ?, ?)",
).run(Number(rejectedSuggestion.lastInsertRowid), "bad", now - 87_000);

for (let index = 0; index < 32; index += 1) {
  const id = insertSuggestion.run(
    sessionId,
    index % 2 === 0 ? `git log --oneline -${index}` : `npm run t${index}`,
    index % 2 === 0 ? `git log --oneline -${index + 1}` : `npm run test:${index}`,
    index % 3 === 0 ? "history" : index % 3 === 1 ? "model" : "history+model",
    cwd,
    repoRoot,
    index % 4 === 0 ? "main" : "feature/suggestions",
    index % 5,
    40 + index * 9,
    52 + index * 11,
    index % 2 === 0 ? "qwen2.5-coder:7b" : "llama3.2:latest",
    index % 3 === 0 ? "" : index % 2 === 0 ? "qwen2.5-coder:7b" : "llama3.2:latest",
    index % 3 === 0 ? -1 : 48 + index * 7,
    index % 5 === 0 ? 90 + index * 5 : 0,
    index % 3 === 0 ? -1 : 14 + index * 2,
    index % 3 === 0 ? -1 : 18 + index * 3,
    index % 3 === 0 ? -1 : 20 + index,
    index % 3 === 0 ? -1 : 9 + Math.floor(index / 2),
    now - 60_000 + index * 900,
  );

  if (index % 6 === 0) {
    insertFeedback.run(
      Number(id.lastInsertRowid),
      sessionId,
      "accepted",
      index % 2 === 0 ? `git log --oneline -${index}` : `npm run t${index}`,
      index % 2 === 0 ? `git log --oneline -${index + 1}` : `npm run test:${index}`,
      index % 2 === 0 ? `git log --oneline -${index + 1}` : `npm run test:${index}`,
      "",
      now - 59_000 + index * 900,
    );
  } else if (index % 7 === 0) {
    insertFeedback.run(
      Number(id.lastInsertRowid),
      sessionId,
      "rejected",
      index % 2 === 0 ? `git log --oneline -${index}` : `npm run t${index}`,
      index % 2 === 0 ? `git log --oneline -${index + 1}` : `npm run test:${index}`,
      "",
      index % 2 === 0 ? "git status" : "npm run lint",
      now - 59_000 + index * 900,
    );
  }

  if (index % 8 === 0) {
    db.prepare(
      "INSERT INTO suggestion_reviews(suggestion_id, review_label, updated_at_ms) VALUES (?, ?, ?)",
    ).run(Number(id.lastInsertRowid), index % 16 === 0 ? "good" : "bad", now - 58_000 + index * 900);
  }
}

const summaryJson = JSON.stringify({
  progress: {
    completed: 4,
    total: 4,
    percent: 100,
    status: "completed",
    currentModel: "qwen2.5-coder:7b",
    currentCase: "build prompt",
    currentRun: 2,
    currentPhase: "hot",
  },
  track: "static",
  surface: "end_to_end",
  suiteName: "core",
  strategy: "history+model",
  timingProtocol: "full",
  datasetSize: 2,
  positiveCaseCount: 2,
  negativeCaseCount: 0,
  overall: {
    count: 2,
    quality: {
      positiveCaseCount: 2,
      negativeCaseCount: 0,
      positiveExactHitRate: 0.5,
      negativeAvoidRate: 0,
      validWinnerRate: 1,
      candidateRecallAt3: 1,
      charsSavedRatio: 0.43,
    },
    latency: {
      count: 2,
      mean: 186,
      median: 186,
      p90: 201,
      p95: 201,
      max: 201,
    },
    startStates: [],
    coldPenaltyMs: 0,
    stages: [],
    budgetPassRates: [],
    categoryBreakdown: [],
    sourceBreakdown: [],
  },
  models: [
    {
      model: "qwen2.5-coder:7b",
      overall: {
        count: 2,
        quality: {
          positiveCaseCount: 2,
          negativeCaseCount: 0,
          positiveExactHitRate: 0.5,
          negativeAvoidRate: 0,
          validWinnerRate: 1,
          candidateRecallAt3: 1,
          charsSavedRatio: 0.43,
        },
        latency: {
          count: 2,
          mean: 186,
          median: 186,
          p90: 201,
          p95: 201,
          max: 201,
        },
        startStates: [],
        coldPenaltyMs: 0,
        stages: [],
        budgetPassRates: [],
        categoryBreakdown: [],
        sourceBreakdown: [],
      },
      cold: { count: 0, quality: { positiveCaseCount: 0, negativeCaseCount: 0, positiveExactHitRate: 0, negativeAvoidRate: 0, validWinnerRate: 0, candidateRecallAt3: 0, charsSavedRatio: 0 }, latency: { count: 0, mean: 0, median: 0, p90: 0, p95: 0, max: 0 }, startStates: [], coldPenaltyMs: 0, stages: [], budgetPassRates: [], categoryBreakdown: [], sourceBreakdown: [] },
      hot: { count: 0, quality: { positiveCaseCount: 0, negativeCaseCount: 0, positiveExactHitRate: 0, negativeAvoidRate: 0, validWinnerRate: 0, candidateRecallAt3: 0, charsSavedRatio: 0 }, latency: { count: 0, mean: 0, median: 0, p90: 0, p95: 0, max: 0 }, startStates: [], coldPenaltyMs: 0, stages: [], budgetPassRates: [], categoryBreakdown: [], sourceBreakdown: [] },
    },
  ],
});

const benchmarkRun = db
  .prepare(`
    INSERT INTO benchmark_runs(
      status, track, surface, suite_name, strategy, timing_protocol,
      models, repeat_count, timeout_ms, filters_json, dataset_size, environment_json,
      output_json_path, summary_json, log_text, last_event_at_ms, error_text,
      created_at_ms, started_at_ms, finished_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  .run(
    "completed",
    "static",
    "end_to_end",
    "core",
    "history+model",
    "full",
    "qwen2.5-coder:7b",
    2,
    5000,
    "",
    2,
    JSON.stringify({ hostname: "seeded-host", os: "darwin", arch: "arm64", goVersion: "go1.24", modelBaseURL: "http://127.0.0.1:11434", modelKeepAlive: "5m", activeModelName: "qwen2.5-coder:7b", dbPath }),
    path.join(stateDir, "benchmarks", "run-1.json"),
    summaryJson,
    [
      "[start] track=static suite=core protocol=full strategy=history+model models=qwen2.5-coder:7b",
      "[stdout] Benchmarking track=static surface=end_to_end suite=core models=qwen2.5-coder:7b cases=2 attempts=4 protocol=full repeat=2",
      "[stdout] [progress] completed=4/4 model=qwen2.5-coder:7b case=build-prompt run=2 phase=hot status=completed",
      "[completed] dataset=2 attempts=4",
    ].join("\n"),
    now - 55_000,
    "",
    now - 60_000,
    now - 59_000,
    now - 55_000,
  );

const runId = Number(benchmarkRun.lastInsertRowid);
const insertBenchmarkResult = db.prepare(`
  INSERT INTO benchmark_results(
    run_id, model_name, track, surface, suite_name, strategy, timing_protocol,
    timing_phase, start_state, case_id, case_name, category, tags_json, label_kind,
    run_number, request_json, expected_command, expected_alternatives_json, negative_target,
    winner_command, winner_source, candidates_json, raw_model_output, cleaned_model_output,
    exact_match, alternative_match, negative_avoided, valid_prefix, candidate_hit_at_3,
    chars_saved_ratio, command_edit_distance, request_latency_ms, model_total_duration_ms,
    model_load_duration_ms, model_prompt_eval_duration_ms, model_eval_duration_ms,
    model_prompt_eval_count, model_eval_count, decode_tokens_per_second,
    non_model_overhead_duration_ms, model_error, error_text, replay_source_json, created_at_ms
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?, ?
  )
`);

insertBenchmarkResult.run(
  runId,
  "qwen2.5-coder:7b",
  "static",
  "end_to_end",
  "core",
  "history+model",
  "full",
  "hot",
  "hot",
  "git-status",
  "git status prompt",
  "git",
  JSON.stringify(["git", "core"]),
  "positive",
  1,
  JSON.stringify({ buffer: "git st" }),
  "git status",
  JSON.stringify([]),
  "",
  "git status",
  "model",
  JSON.stringify([{ command: "git status", source: "model", score: 1 }]),
  "git status",
  "git status",
  1,
  0,
  0,
  1,
  1,
  0.56,
  0,
  172,
  150,
  0,
  44,
  78,
  30,
  12,
  153.8,
  22,
  "",
  "",
  "",
  now - 58_000,
);
insertBenchmarkResult.run(
  runId,
  "qwen2.5-coder:7b",
  "static",
  "end_to_end",
  "core",
  "history+model",
  "full",
  "hot",
  "hot",
  "build-prompt",
  "build prompt",
  "build-test",
  JSON.stringify(["npm", "build"]),
  "positive",
  2,
  JSON.stringify({ buffer: "npm run b" }),
  "npm run build",
  JSON.stringify([]),
  "",
  "npm run build",
  "model",
  JSON.stringify([{ command: "npm run build", source: "model", score: 1 }]),
  "npm run build",
  "npm run build",
  1,
  0,
  0,
  1,
  1,
  0.3,
  0,
  201,
  180,
  0,
  51,
  88,
  28,
  13,
  147.7,
  21,
  "",
  "",
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
