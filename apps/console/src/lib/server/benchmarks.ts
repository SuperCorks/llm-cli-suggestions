import "server-only";

import path from "node:path";
import { spawn } from "node:child_process";

import { getDb } from "@/lib/server/db";
import { getBenchOutputDir, getProjectRoot, getResolvedRuntimeSettings } from "@/lib/server/config";

export function createBenchmarkRun(input: {
  track: "static" | "replay" | "raw";
  suiteName: string;
  strategy: string;
  timingProtocol: "cold_only" | "hot_only" | "mixed" | "full";
  models: string[];
  repeatCount: number;
  timeoutMs: number;
  replaySampleLimit: number;
}) {
  const db = getDb();
  const runtime = getResolvedRuntimeSettings();
  const createdAtMs = Date.now();
  const outputJsonPath = path.join(
    getBenchOutputDir(),
    `benchmark-${createdAtMs}-${Math.random().toString(36).slice(2)}.json`,
  );

  const initialSummary = JSON.stringify({
    progress: {
      completed: 0,
      total: 0,
      percent: 0,
      status: "queued",
      currentModel: "",
      currentCase: "",
      currentRun: 0,
      currentPhase: "",
    },
    track: input.track,
    surface: input.track === "raw" ? "raw_model" : "end_to_end",
    suiteName: input.suiteName,
    strategy: input.strategy,
    timingProtocol: input.timingProtocol,
    datasetSize: 0,
    positiveCaseCount: 0,
    negativeCaseCount: 0,
    overall: {},
    models: [],
  });
  const filtersJson =
    input.track === "replay" ? JSON.stringify({ sample_limit: input.replaySampleLimit }) : "";
  const environmentJson = JSON.stringify({
    hostname: "",
    os: process.platform,
    arch: process.arch,
    goVersion: "",
    modelBaseURL: runtime.modelBaseUrl,
    modelKeepAlive: runtime.modelKeepAlive,
    activeModelName: runtime.modelName,
    dbPath: runtime.dbPath,
  });

  const result = db
    .prepare(
      `INSERT INTO benchmark_runs(
         status, track, surface, suite_name, strategy, timing_protocol,
      models, repeat_count, timeout_ms, filters_json, dataset_size, environment_json,
      output_json_path, summary_json, log_text, last_event_at_ms, error_text, created_at_ms
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`,
    )
    .run(
      "queued",
      input.track,
      input.track === "raw" ? "raw_model" : "end_to_end",
      input.suiteName,
      input.strategy,
      input.timingProtocol,
      input.models.join(","),
      input.repeatCount,
      input.timeoutMs,
      filtersJson,
      0,
      environmentJson,
      outputJsonPath,
      initialSummary,
      `[queued] track=${input.track} suite=${input.suiteName} protocol=${input.timingProtocol} models=${input.models.join(",")}`,
      createdAtMs,
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
      "--track",
      input.track,
      "--suite",
      input.suiteName,
      "--strategy",
      input.strategy,
      "--protocol",
      input.timingProtocol,
      "--models",
      input.models.join(","),
      "--repeat",
      String(input.repeatCount),
      "--timeout-ms",
      String(input.timeoutMs),
      "--sample-limit",
      String(input.replaySampleLimit),
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
