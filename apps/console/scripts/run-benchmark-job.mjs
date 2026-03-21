import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return "";
  }
  return process.argv[index + 1];
}

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS benchmark_runs (
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

    CREATE TABLE IF NOT EXISTS benchmark_results (
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
}

function summarize(results) {
  const byModel = new Map();
  for (const row of results) {
    const entry = byModel.get(row.model) || {
      total: 0,
      validPrefix: 0,
      accepted: 0,
      avgLatencyMs: 0,
    };
    entry.total += 1;
    if (row.valid_prefix) {
      entry.validPrefix += 1;
    }
    if (row.accepted) {
      entry.accepted += 1;
    }
    entry.avgLatencyMs += Number(row.latency_ms || 0);
    byModel.set(row.model, entry);
  }

  return Object.fromEntries(
    [...byModel.entries()].map(([model, value]) => [
      model,
      {
        total: value.total,
        validPrefixRate: value.total > 0 ? value.validPrefix / value.total : 0,
        acceptedRate: value.total > 0 ? value.accepted / value.total : 0,
        avgLatencyMs: value.total > 0 ? value.avgLatencyMs / value.total : 0,
      },
    ]),
  );
}

async function main() {
  const dbPath = argValue("--db");
  const runId = Number(argValue("--run-id"));
  const root = argValue("--root");
  const models = argValue("--models");
  const repeat = argValue("--repeat");
  const timeoutMs = argValue("--timeout-ms");
  const outputJson = argValue("--output-json");

  const db = new Database(dbPath);
  ensureTables(db);

  db.prepare("UPDATE benchmark_runs SET status = ?, started_at_ms = ? WHERE id = ?").run(
    "running",
    Date.now(),
    runId,
  );

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        path.join(root, "bin", "model-bench"),
        [
          "-models",
          models,
          "-repeat",
          repeat,
          "-timeout-ms",
          timeoutMs,
          "-output-json",
          outputJson,
        ],
        {
          cwd: root,
          stdio: ["ignore", "ignore", "pipe"],
        },
      );

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve(undefined);
          return;
        }
        reject(new Error(stderr || `model-bench exited with code ${code}`));
      });
    });

    const results = JSON.parse(fs.readFileSync(outputJson, "utf8"));
    const insert = db.prepare(`
      INSERT INTO benchmark_results(
        run_id, model_name, case_name, run_number, latency_ms,
        suggestion_text, valid_prefix, accepted, error_text, created_at_ms
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    const transaction = db.transaction((rows) => {
      db.prepare("DELETE FROM benchmark_results WHERE run_id = ?").run(runId);
      for (const row of rows) {
        insert.run(
          runId,
          row.model || "",
          row.case_name || "",
          Number(row.run || 0),
          Number(row.latency_ms || 0),
          row.suggestion || "",
          row.valid_prefix ? 1 : 0,
          row.accepted ? 1 : 0,
          row.error || "",
          now,
        );
      }
    });
    transaction(results);

    db.prepare(
      `UPDATE benchmark_runs
       SET status = ?, summary_json = ?, finished_at_ms = ?, error_text = ''
       WHERE id = ?`,
    ).run("completed", JSON.stringify(summarize(results)), Date.now(), runId);
  } catch (error) {
    db.prepare(
      `UPDATE benchmark_runs
       SET status = ?, error_text = ?, finished_at_ms = ?
       WHERE id = ?`,
    ).run(
      "failed",
      error instanceof Error ? error.message : "benchmark failed",
      Date.now(),
      runId,
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
