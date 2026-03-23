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

function updateRunSummary(db, runId, summary) {
  db.prepare("UPDATE benchmark_runs SET summary_json = ? WHERE id = ?").run(
    JSON.stringify(summary),
    runId,
  );
}

function readResults(outputJson) {
  if (!outputJson || !fs.existsSync(outputJson)) {
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(outputJson, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

function persistResults(db, runId, rows) {
  const insert = db.prepare(`
    INSERT INTO benchmark_results(
      run_id, model_name, case_name, run_number, latency_ms,
      suggestion_text, valid_prefix, accepted, error_text, created_at_ms
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = Date.now();
  const transaction = db.transaction((results) => {
    db.prepare("DELETE FROM benchmark_results WHERE run_id = ?").run(runId);
    for (const row of results) {
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

  transaction(rows);
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
  let progress = {
    completed: 0,
    total: 0,
    percent: 0,
    status: "running",
    currentModel: "",
    currentCase: "",
    currentRun: 0,
  };

  db.prepare("UPDATE benchmark_runs SET status = ?, started_at_ms = ?, summary_json = ? WHERE id = ?").run(
    "running",
    Date.now(),
    JSON.stringify({ progress, models: {} }),
    runId,
  );

  let runError = null;
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
          const introMatch = line.match(/Benchmarking (\d+) model\(s\) across (\d+) case\(s\), repeat=(\d+)/);
          if (introMatch) {
            const modelCount = Number(introMatch[1] || 0);
            const caseCount = Number(introMatch[2] || 0);
            const repeatCount = Number(introMatch[3] || 0);
            progress = {
              ...progress,
              total: modelCount * caseCount * repeatCount,
              percent: 0,
            };
            updateRunSummary(db, runId, { progress, models: {} });
            continue;
          }

          const runMatch = line.match(/\[(?:ok|error)\] model=(.+?) case=(.+?) run=(\d+)/);
          if (!runMatch) {
            continue;
          }

          progress = {
            ...progress,
            completed: progress.completed + 1,
            percent:
              progress.total > 0
                ? Math.round(((progress.completed + 1) / progress.total) * 100)
                : progress.percent,
            currentModel: runMatch[1] || "",
            currentCase: runMatch[2] || "",
            currentRun: Number(runMatch[3] || 0),
          };
          updateRunSummary(db, runId, { progress, models: {} });
        }
      });
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
  } catch (error) {
    runError = error instanceof Error ? error : new Error("benchmark failed");
  }

  const results = readResults(outputJson);
  persistResults(db, runId, results);

  const lastResult = results.at(-1);
  const completed = results.length;
  const total = progress.total > 0 ? progress.total : completed;
  progress = {
    ...progress,
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    status: runError ? "failed" : "completed",
    currentModel: lastResult?.model || progress.currentModel,
    currentCase: lastResult?.case_name || progress.currentCase,
    currentRun: Number(lastResult?.run || progress.currentRun || 0),
  };

  if (runError) {
    db.prepare(
      `UPDATE benchmark_runs
       SET status = ?, error_text = ?, finished_at_ms = ?, summary_json = ?
       WHERE id = ?`,
    ).run(
      "failed",
      runError.message,
      Date.now(),
      JSON.stringify({ progress, models: summarize(results) }),
      runId,
    );
  } else {
    progress = {
      ...progress,
      completed,
      total: completed,
      percent: 100,
      status: "completed",
    };

    db.prepare(
      `UPDATE benchmark_runs
       SET status = ?, summary_json = ?, finished_at_ms = ?, error_text = ''
       WHERE id = ?`,
    ).run(
      "completed",
      JSON.stringify({ progress, models: summarize(results) }),
      Date.now(),
      runId,
    );
  }

  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
