import "server-only";

import path from "node:path";
import { spawn } from "node:child_process";

import { getDb } from "@/lib/server/db";
import { getBenchOutputDir, getProjectRoot, getResolvedRuntimeSettings } from "@/lib/server/config";

export function createBenchmarkRun(input: {
  models: string[];
  repeatCount: number;
  timeoutMs: number;
}) {
  const db = getDb();
  const createdAtMs = Date.now();
  const outputJsonPath = path.join(
    getBenchOutputDir(),
    `benchmark-${createdAtMs}-${Math.random().toString(36).slice(2)}.json`,
  );

  const result = db
    .prepare(
      `INSERT INTO benchmark_runs(
         status, models, repeat_count, timeout_ms, output_json_path, summary_json, error_text, created_at_ms
       ) VALUES(?, ?, ?, ?, ?, '', '', ?)`,
    )
    .run(
      "queued",
      input.models.join(","),
      input.repeatCount,
      input.timeoutMs,
      outputJsonPath,
      createdAtMs,
    );

  const runId = Number(result.lastInsertRowid);
  const scriptPath = path.join(getProjectRoot(), "apps", "console", "scripts", "run-benchmark-job.mjs");
  const child = spawn(
    process.execPath,
    [
      scriptPath,
      "--db",
      getResolvedRuntimeSettings().dbPath,
      "--run-id",
      String(runId),
      "--root",
      getProjectRoot(),
      "--models",
      input.models.join(","),
      "--repeat",
      String(input.repeatCount),
      "--timeout-ms",
      String(input.timeoutMs),
      "--output-json",
      outputJsonPath,
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();

  return { runId };
}
