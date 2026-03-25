import fs from "node:fs";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";

const SQLITE_BUSY_TIMEOUT_MS = 15_000;

const BENCHMARK_RESULT_COLUMNS = [
  "run_id",
  "model_name",
  "track",
  "surface",
  "suite_name",
  "strategy",
  "timing_protocol",
  "timing_phase",
  "start_state",
  "case_id",
  "case_name",
  "category",
  "tags_json",
  "label_kind",
  "run_number",
  "request_json",
  "expected_command",
  "expected_alternatives_json",
  "negative_target",
  "winner_command",
  "winner_source",
  "candidates_json",
  "raw_model_output",
  "cleaned_model_output",
  "exact_match",
  "alternative_match",
  "negative_avoided",
  "valid_prefix",
  "candidate_hit_at_3",
  "chars_saved_ratio",
  "command_edit_distance",
  "request_latency_ms",
  "model_total_duration_ms",
  "model_load_duration_ms",
  "model_prompt_eval_duration_ms",
  "model_eval_duration_ms",
  "model_prompt_eval_count",
  "model_eval_count",
  "decode_tokens_per_second",
  "non_model_overhead_duration_ms",
  "model_error",
  "error_text",
  "replay_source_json",
  "created_at_ms",
];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return "";
  }
  return process.argv[index + 1];
}

function hasTable(db, tableName) {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .pluck()
      .get(tableName),
  );
}

function getColumnNames(db, tableName) {
  if (!hasTable(db, tableName)) {
    return new Set();
  }
  return new Set(
    db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => String(row.name)),
  );
}

function ensureTables(db) {
  const runColumns = getColumnNames(db, "benchmark_runs");
  const resultColumns = getColumnNames(db, "benchmark_results");
  if (
    (runColumns.size > 0 &&
      (!runColumns.has("track") || !runColumns.has("log_text") || !runColumns.has("last_event_at_ms"))) ||
    (resultColumns.size > 0 && !resultColumns.has("case_id"))
  ) {
    db.exec("DROP TABLE IF EXISTS benchmark_results; DROP TABLE IF EXISTS benchmark_runs;");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS benchmark_runs (
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

    CREATE TABLE IF NOT EXISTS benchmark_results (
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

    CREATE INDEX IF NOT EXISTS idx_benchmark_results_run_id ON benchmark_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_benchmark_results_model ON benchmark_results(model_name, run_id);
    CREATE INDEX IF NOT EXISTS idx_benchmark_results_category ON benchmark_results(category, run_id);
  `);
}

function trimLogText(logText) {
  const lines = logText.split(/\r?\n/).filter(Boolean);
  return lines.slice(-200).join("\n");
}

function appendRunLog(db, runId, line) {
  if (!line) {
    return;
  }

  const previous = db
    .prepare("SELECT log_text AS logText FROM benchmark_runs WHERE id = ?")
    .get(runId);
  const nextLog = trimLogText(
    [previous?.logText || "", line]
      .filter(Boolean)
      .join("\n"),
  );
  db.prepare("UPDATE benchmark_runs SET log_text = ?, last_event_at_ms = ? WHERE id = ?").run(
    nextLog,
    Date.now(),
    runId,
  );
}

function updateRunSummary(db, runId, summary) {
  db.prepare("UPDATE benchmark_runs SET summary_json = ?, last_event_at_ms = ? WHERE id = ?").run(
    JSON.stringify(summary),
    Date.now(),
    runId,
  );
}

function readArtifact(outputJson) {
  if (!outputJson || !fs.existsSync(outputJson)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(outputJson, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { legacy: true, raw: parsed };
  }
  return parsed;
}

function extractLoggedError(logText) {
  const taggedErrors = [...logText.matchAll(/\[error\]\s+([^\n]+)/g)];
  if (taggedErrors.length > 0) {
    return String(taggedErrors.at(-1)?.[1] || "").trim();
  }

  const workerErrors = [...logText.matchAll(/\[stderr\]\s+(benchmark failed early:[^\n]+)/g)];
  if (workerErrors.length > 0) {
    return String(workerErrors.at(-1)?.[1] || "").trim();
  }

  return "";
}

function markRunFailed(db, runId, errorText, summary) {
  const timestamp = Date.now();
  db.prepare(`
    UPDATE benchmark_runs
    SET status = 'failed',
        summary_json = COALESCE(?, summary_json),
        error_text = ?,
        last_event_at_ms = ?,
        finished_at_ms = CASE WHEN finished_at_ms > 0 THEN finished_at_ms ELSE ? END
    WHERE id = ?
  `).run(
    summary ? JSON.stringify(summary) : null,
    errorText,
    timestamp,
    timestamp,
    runId,
  );
  appendRunLog(db, runId, `[error] ${errorText}`);
}

function persistResults(db, runId, artifact) {
  const insert = db.prepare(`
    INSERT INTO benchmark_results(${BENCHMARK_RESULT_COLUMNS.join(", ")})
    VALUES(${BENCHMARK_RESULT_COLUMNS.map(() => "?").join(", ")})
  `);

  const transaction = db.transaction((attempts) => {
    db.prepare("DELETE FROM benchmark_results WHERE run_id = ?").run(runId);
    for (const attempt of attempts) {
      const values = [
        runId,
        attempt.model || "",
        attempt.track || "",
        attempt.surface || "",
        attempt.suite_name || "",
        attempt.strategy || "",
        attempt.timing_protocol || "",
        attempt.timing_phase || "",
        attempt.start_state || "",
        attempt.case_id || "",
        attempt.case_name || "",
        attempt.category || "",
        JSON.stringify(attempt.tags || []),
        attempt.label_kind || "",
        Number(attempt.run || 0),
        JSON.stringify(attempt.request || {}),
        attempt.expected_command || "",
        JSON.stringify(attempt.expected_alternatives || []),
        attempt.negative_target || "",
        attempt.winner_command || "",
        attempt.winner_source || "",
        JSON.stringify(attempt.top_candidates || []),
        attempt.raw_model_output || "",
        attempt.cleaned_model_output || "",
        attempt.exact_match ? 1 : 0,
        attempt.alternative_match ? 1 : 0,
        attempt.negative_avoided ? 1 : 0,
        attempt.valid_prefix ? 1 : 0,
        attempt.candidate_hit_at_3 ? 1 : 0,
        Number(attempt.chars_saved_ratio || 0),
        Number(attempt.command_edit_distance || 0),
        Number(attempt.request_latency_ms || 0),
        Number(attempt.model_total_duration_ms || 0),
        Number(attempt.model_load_duration_ms || 0),
        Number(attempt.model_prompt_eval_duration_ms || 0),
        Number(attempt.model_eval_duration_ms || 0),
        Number(attempt.model_prompt_eval_count || 0),
        Number(attempt.model_eval_count || 0),
        Number(attempt.decode_tokens_per_second || 0),
        Number(attempt.non_model_overhead_duration_ms || 0),
        attempt.model_error || "",
        attempt.error || "",
        JSON.stringify(attempt.replay_source || {}),
        Date.now(),
      ];

      if (values.length !== BENCHMARK_RESULT_COLUMNS.length) {
        throw new Error(
          `benchmark result insert expects ${BENCHMARK_RESULT_COLUMNS.length} values but received ${values.length}`,
        );
      }

      insert.run(...values);
    }
  });

  transaction(Array.isArray(artifact?.attempts) ? artifact.attempts : []);
}

function updateRunFromArtifact(db, runId, artifact, runError) {
  const artifactError =
    !artifact && !runError
      ? new Error("benchmark worker completed without writing an artifact; rerun after refreshing the benchmark command")
      :
    artifact?.legacy
      ? new Error(
          "benchmark worker received a legacy artifact format; rerun after refreshing the benchmark command",
        )
      : null;
  const finalError = runError || artifactError;
  const summary = artifact?.summary || null;
  const run = artifact?.run || null;
  const status = finalError ? "failed" : "completed";
  db.prepare(`
    UPDATE benchmark_runs
    SET status = ?,
        track = COALESCE(?, track),
        surface = COALESCE(?, surface),
        suite_name = COALESCE(?, suite_name),
        strategy = COALESCE(?, strategy),
        timing_protocol = COALESCE(?, timing_protocol),
        filters_json = COALESCE(?, filters_json),
        dataset_size = COALESCE(?, dataset_size),
        environment_json = COALESCE(?, environment_json),
        summary_json = COALESCE(?, summary_json),
        last_event_at_ms = ?,
        error_text = ?,
        finished_at_ms = ?
    WHERE id = ?
  `).run(
    status,
    run?.track || null,
    run?.surface || null,
    run?.suite_name || null,
    run?.strategy || null,
    run?.timing_protocol || null,
    run?.filters_json ?? null,
    Number(run?.dataset_size ?? 0),
    run?.environment ? JSON.stringify(run.environment) : null,
    summary ? JSON.stringify(summary) : null,
    Date.now(),
    finalError ? finalError.message : "",
    Date.now(),
    runId,
  );
  if (finalError) {
    appendRunLog(db, runId, `[error] ${finalError.message}`);
  } else {
    appendRunLog(db, runId, `[completed] dataset=${Number(run?.dataset_size ?? 0)} attempts=${Array.isArray(artifact?.attempts) ? artifact.attempts.length : 0}`);
  }
}

async function main() {
  const dbPath = argValue("--db");
  const runId = Number(argValue("--run-id"));
  const root = argValue("--root");
  const track = argValue("--track") || "static";
  const suite = argValue("--suite") || (track === "replay" ? "live-db" : "core");
  const strategy = argValue("--strategy") || "history+model";
  const protocol = argValue("--protocol") || "full";
  const models = argValue("--models");
  const repeat = argValue("--repeat");
  const timeoutMs = argValue("--timeout-ms");
  const sampleLimit = argValue("--sample-limit");
  const outputJson = argValue("--output-json");

  const db = new Database(dbPath, { timeout: SQLITE_BUSY_TIMEOUT_MS });
  db.pragma("journal_mode = WAL");
  db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  ensureTables(db);

  let progress = {
    completed: 0,
    total: 0,
    percent: 0,
    status: "running",
    currentModel: "",
    currentCase: "",
    currentRun: 0,
    currentPhase: "",
  };
  const summary = {
    progress,
    track,
    surface: track === "raw" ? "raw_model" : "end_to_end",
    suiteName: suite,
    strategy,
    timingProtocol: protocol,
    datasetSize: 0,
    positiveCaseCount: 0,
    negativeCaseCount: 0,
    overall: {},
    models: [],
  };

  db.prepare(`
    UPDATE benchmark_runs
    SET status = ?, started_at_ms = ?, summary_json = ?, last_event_at_ms = ?
    WHERE id = ?
  `).run(
    "running",
    Date.now(),
    JSON.stringify(summary),
    Date.now(),
    runId,
  );
  appendRunLog(
    db,
    runId,
    `[start] track=${track} suite=${suite} protocol=${protocol} strategy=${strategy} models=${models}`,
  );

  let runError = null;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        "go",
        [
          "run",
          "./cmd/model-bench",
          track,
          "--suite",
          suite,
          "--strategy",
          strategy,
          "--protocol",
          protocol,
          "--models",
          models,
          "--repeat",
          repeat,
          "--timeout-ms",
          timeoutMs,
          "--sample-limit",
          sampleLimit,
          "--db-path",
          dbPath,
          "--output-json",
          outputJson,
        ],
        {
          cwd: root,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
        const lines = stdout.split(/\r?\n/);
        stdout = lines.pop() || "";
        for (const line of lines) {
          appendRunLog(db, runId, `[stdout] ${line}`);
          const introMatch = line.match(/attempts=(\d+)/);
          if (introMatch) {
            progress = {
              ...summary.progress,
              total: Number(introMatch[1] || 0),
            };
            summary.progress = progress;
            updateRunSummary(db, runId, summary);
            continue;
          }

          const progressMatch = line.match(/\[progress\] completed=(\d+)\/(\d+) model=(.+?) case=(.+?) run=(\d+) phase=(.+?) status=(.+)$/);
          if (!progressMatch) {
            continue;
          }

          progress = {
            completed: Number(progressMatch[1] || 0),
            total: Number(progressMatch[2] || summary.progress.total || 0),
            percent:
              Number(progressMatch[2] || 0) > 0
                ? Math.round((Number(progressMatch[1] || 0) / Number(progressMatch[2] || 1)) * 100)
                : 0,
            status: progressMatch[7] || "running",
            currentModel: progressMatch[3] || "",
            currentCase: progressMatch[4] || "",
            currentRun: Number(progressMatch[5] || 0),
            currentPhase: progressMatch[6] || "",
          };
          summary.progress = progress;
          updateRunSummary(db, runId, summary);
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
        const stderrLines = chunk
          .toString("utf8")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        for (const line of stderrLines) {
          appendRunLog(db, runId, `[stderr] ${line}`);
        }
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (stdout.trim()) {
          appendRunLog(db, runId, `[stdout] ${stdout.trim()}`);
        }
        if (stderr.trim()) {
          appendRunLog(db, runId, `[stderr] ${stderr.trim()}`);
        }
        if (code === 0) {
          resolve(undefined);
          return;
        }
        reject(new Error(stderr || `model-bench exited with code ${code}`));
      });
    });
  } catch (error) {
    runError = error instanceof Error ? error : new Error("benchmark failed");
  }

  let artifact = null;
  try {
    artifact = readArtifact(outputJson);
    if (artifact) {
      persistResults(db, runId, artifact);
    }
    updateRunFromArtifact(db, runId, artifact, runError);
  } catch (error) {
    const finalizationError = error instanceof Error ? error : new Error("benchmark finalization failed");
    const fallbackErrorText = [
      runError?.message,
      `benchmark finalization failed: ${finalizationError.message}`,
      extractLoggedError(
        String(
          db.prepare("SELECT log_text AS logText FROM benchmark_runs WHERE id = ?").get(runId)?.logText || "",
        ),
      ),
    ]
      .filter(Boolean)
      .join("; ");

    try {
      markRunFailed(db, runId, fallbackErrorText || "benchmark worker failed", artifact?.summary || null);
    } catch {
      // Best effort only. The original finalization error is already captured in the worker log.
    }
  } finally {
    db.close();
  }
}

await main();
