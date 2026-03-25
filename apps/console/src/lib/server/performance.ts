import "server-only";

import { getDb } from "@/lib/server/db";

export type PerformanceStartState = "cold" | "hot" | "unknown" | "not-applicable";

export interface PerformanceDashboardFilters {
  preset: string;
  startInput: string;
  endInput: string;
  startMs: number;
  endMs: number;
  model: string;
  source: string;
  startState: "all" | PerformanceStartState;
}

export interface PerformanceDashboardData {
  filters: PerformanceDashboardFilters;
  comparisonWindow: {
    startMs: number;
    endMs: number;
  };
  modelOptions: string[];
  sourceOptions: string[];
  summary: {
    totalSuggestions: number;
    avgLatencyMs: number;
    medianLatencyMs: number;
    p95LatencyMs: number;
    coldPenaltyMs: number | null;
    modelInvokedCount: number;
    coldShare: number;
  };
  previousSummary: {
    totalSuggestions: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    coldShare: number;
  };
  instrumentation: {
    modelInvokedCount: number;
    instrumentedCount: number;
    knownStartStateCount: number;
    unknownStartStateCount: number;
  };
  startStates: Array<{
    key: PerformanceStartState;
    label: string;
    count: number;
    share: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    avgLoadDurationMs: number;
  }>;
  timeline: {
    bucketLabelFormat: "hour" | "day";
    points: Array<{
      timestampMs: number;
      label: string;
      count: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      coldAvgLatencyMs: number | null;
      hotAvgLatencyMs: number | null;
    }>;
  };
  histogram: Array<{
    label: string;
    count: number;
    coldCount: number;
    hotCount: number;
    unknownCount: number;
    notApplicableCount: number;
  }>;
  stageBreakdown: Array<{
    key: "cold" | "hot";
    label: string;
    count: number;
    avgRequestLatencyMs: number;
    avgModelTotalDurationMs: number;
    avgLoadDurationMs: number;
    avgPromptEvalDurationMs: number;
    avgEvalDurationMs: number;
    avgOverheadDurationMs: number;
    tokensPerSecond: number | null;
  }>;
  sourceBreakdown: Array<{
    source: string;
    count: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    coldShare: number;
  }>;
  cwdLeaderboard: Array<{
    path: string;
    count: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    coldShare: number;
  }>;
  bufferLeaderboard: Array<{
    buffer: string;
    count: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    coldCount: number;
  }>;
}

interface PerformanceRow {
  source: string;
  cwd: string;
  buffer: string;
  modelName: string;
  requestModelName: string;
  latencyMs: number;
  requestLatencyMs: number;
  createdAtMs: number;
  modelTotalDurationMs: number;
  modelLoadDurationMs: number;
  modelPromptEvalDurationMs: number;
  modelEvalDurationMs: number;
  modelPromptEvalCount: number;
  modelEvalCount: number;
}

const START_STATE_LABELS: Record<PerformanceStartState, string> = {
  cold: "Cold / wake required",
  hot: "Hot / already resident",
  unknown: "Unknown start state",
  "not-applicable": "No model invocation",
};

const LATENCY_BANDS = [
  { label: "<100 ms", max: 100 },
  { label: "100-249 ms", max: 250 },
  { label: "250-499 ms", max: 500 },
  { label: "500-999 ms", max: 1000 },
  { label: "1-1.9 s", max: 2000 },
  { label: "2-3.9 s", max: 4000 },
  { label: "4 s+", max: Number.POSITIVE_INFINITY },
] as const;

export function getPerformanceRangeBounds() {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         MIN(created_at_ms) AS minCreatedAtMs,
         MAX(created_at_ms) AS maxCreatedAtMs
       FROM suggestions`,
    )
    .get() as { minCreatedAtMs: number | null; maxCreatedAtMs: number | null } | undefined;

  return {
    minCreatedAtMs:
      row && typeof row.minCreatedAtMs === "number" && Number.isFinite(row.minCreatedAtMs)
        ? row.minCreatedAtMs
        : null,
    maxCreatedAtMs:
      row && typeof row.maxCreatedAtMs === "number" && Number.isFinite(row.maxCreatedAtMs)
        ? row.maxCreatedAtMs
        : null,
  };
}

export function getPerformanceDashboardData(filters: PerformanceDashboardFilters): PerformanceDashboardData {
  const db = getDb();
  const modelOptions = db
    .prepare(
      `SELECT DISTINCT model
       FROM (
         SELECT model_name AS model FROM suggestions WHERE TRIM(model_name) <> ''
         UNION
         SELECT request_model_name AS model FROM suggestions WHERE TRIM(request_model_name) <> ''
       )
       ORDER BY model ASC`,
    )
    .all()
    .map((row) => String((row as { model: string }).model))
    .filter(Boolean);
  const sourceOptions = db
    .prepare(
      `SELECT DISTINCT source
       FROM suggestions
       WHERE TRIM(source) <> ''
       ORDER BY source ASC`,
    )
    .all()
    .map((row) => String((row as { source: string }).source))
    .filter(Boolean);

  const currentRows = queryRows(filters);
  const durationMs = Math.max(60_000, filters.endMs - filters.startMs);
  const comparisonWindow = {
    startMs: filters.startMs - durationMs,
    endMs: filters.startMs,
  };
  const previousRows = queryRows({
    ...filters,
    startMs: comparisonWindow.startMs,
    endMs: comparisonWindow.endMs,
  });

  const summary = summarizeRows(currentRows);
  const previousSummary = summarizeRows(previousRows);
  const instrumentation = summarizeInstrumentation(currentRows);

  return {
    filters,
    comparisonWindow,
    modelOptions,
    sourceOptions,
    summary,
    previousSummary,
    instrumentation,
    startStates: summarizeStartStates(currentRows),
    timeline: buildTimeline(currentRows, filters.startMs, filters.endMs),
    histogram: buildHistogram(currentRows),
    stageBreakdown: buildStageBreakdown(currentRows),
    sourceBreakdown: buildSourceBreakdown(currentRows),
    cwdLeaderboard: buildCwdLeaderboard(currentRows),
    bufferLeaderboard: buildBufferLeaderboard(currentRows),
  };
}

function queryRows(filters: PerformanceDashboardFilters) {
  const db = getDb();
  const clauses = ["created_at_ms >= ?", "created_at_ms < ?"];
  const params: Array<number | string> = [filters.startMs, filters.endMs];

  if (filters.model) {
    clauses.push("(request_model_name = ? OR (request_model_name = '' AND model_name = ?))");
    params.push(filters.model, filters.model);
  }
  if (filters.source) {
    clauses.push("source = ?");
    params.push(filters.source);
  }

  const rows = db
    .prepare(
      `SELECT
         source,
         cwd,
         buffer,
         model_name AS modelName,
         request_model_name AS requestModelName,
         latency_ms AS latencyMs,
         request_latency_ms AS requestLatencyMs,
         created_at_ms AS createdAtMs,
         model_total_duration_ms AS modelTotalDurationMs,
         model_load_duration_ms AS modelLoadDurationMs,
         model_prompt_eval_duration_ms AS modelPromptEvalDurationMs,
         model_eval_duration_ms AS modelEvalDurationMs,
         model_prompt_eval_count AS modelPromptEvalCount,
         model_eval_count AS modelEvalCount
       FROM suggestions
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at_ms ASC`,
    )
    .all(...params) as PerformanceRow[];

  return rows.filter((row) => {
    if (filters.startState === "all") {
      return true;
    }
    return getStartState(row) === filters.startState;
  });
}

function getEffectiveLatency(row: PerformanceRow) {
  if (row.requestLatencyMs > 0) {
    return row.requestLatencyMs;
  }
  return Math.max(0, row.latencyMs);
}

function getStartState(row: PerformanceRow): PerformanceStartState {
  if (!row.requestModelName.trim()) {
    return "not-applicable";
  }

  if (!hasModelInstrumentation(row)) {
    return "unknown";
  }

  return row.modelLoadDurationMs > 0 ? "cold" : "hot";
}

function hasModelInstrumentation(row: PerformanceRow) {
  return (
    row.modelTotalDurationMs >= 0 ||
    row.modelLoadDurationMs >= 0 ||
    row.modelPromptEvalDurationMs >= 0 ||
    row.modelEvalDurationMs >= 0 ||
    row.modelPromptEvalCount >= 0 ||
    row.modelEvalCount >= 0
  );
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] || 0;
}

function summarizeRows(rows: PerformanceRow[]) {
  const latencies = rows.map(getEffectiveLatency);
  const coldRows = rows.filter((row) => getStartState(row) === "cold");
  const hotRows = rows.filter((row) => getStartState(row) === "hot");
  const modelInvokedRows = rows.filter((row) => row.requestModelName.trim() !== "");
  return {
    totalSuggestions: rows.length,
    avgLatencyMs: average(latencies),
    medianLatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    coldPenaltyMs:
      coldRows.length > 0 && hotRows.length > 0
        ? average(coldRows.map(getEffectiveLatency)) - average(hotRows.map(getEffectiveLatency))
        : null,
    modelInvokedCount: modelInvokedRows.length,
    coldShare:
      modelInvokedRows.length > 0
        ? coldRows.length / modelInvokedRows.length
        : 0,
  };
}

function summarizeInstrumentation(rows: PerformanceRow[]) {
  const modelInvokedCount = rows.filter((row) => row.requestModelName.trim() !== "").length;
  const instrumentedCount = rows.filter(
    (row) => row.requestModelName.trim() !== "" && hasModelInstrumentation(row),
  ).length;
  const knownStartStateCount = rows.filter((row) => {
    const startState = getStartState(row);
    return startState === "cold" || startState === "hot";
  }).length;
  const unknownStartStateCount = rows.filter((row) => getStartState(row) === "unknown").length;

  return {
    modelInvokedCount,
    instrumentedCount,
    knownStartStateCount,
    unknownStartStateCount,
  };
}

function summarizeStartStates(rows: PerformanceRow[]) {
  const total = rows.length;
  return (["cold", "hot", "unknown", "not-applicable"] as PerformanceStartState[])
    .map((key) => {
      const stateRows = rows.filter((row) => getStartState(row) === key);
      return {
        key,
        label: START_STATE_LABELS[key],
        count: stateRows.length,
        share: total > 0 ? stateRows.length / total : 0,
        avgLatencyMs: average(stateRows.map(getEffectiveLatency)),
        p95LatencyMs: percentile(stateRows.map(getEffectiveLatency), 0.95),
        avgLoadDurationMs: average(
          stateRows
            .map((row) => row.modelLoadDurationMs)
            .filter((value) => value >= 0),
        ),
      };
    })
    .filter((row) => row.count > 0);
}

function buildTimeline(rows: PerformanceRow[], startMs: number, endMs: number) {
  const durationMs = Math.max(60_000, endMs - startMs);
  const bucketSizeMs = durationMs <= 48 * 60 * 60 * 1000 ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const bucketLabelFormat: "hour" | "day" =
    bucketSizeMs < 24 * 60 * 60 * 1000 ? "hour" : "day";
  const bucketCount = Math.max(1, Math.ceil(durationMs / bucketSizeMs));
  const formatter = new Intl.DateTimeFormat("en-US", bucketLabelFormat === "hour"
    ? { month: "short", day: "numeric", hour: "numeric" }
    : { month: "short", day: "numeric" });

  return {
    bucketLabelFormat,
    points: Array.from({ length: bucketCount }, (_, index) => {
      const bucketStart = startMs + index * bucketSizeMs;
      const bucketEnd = Math.min(endMs, bucketStart + bucketSizeMs);
      const bucketRows = rows.filter(
        (row) => row.createdAtMs >= bucketStart && row.createdAtMs < bucketEnd,
      );
      const coldRows = bucketRows.filter((row) => getStartState(row) === "cold");
      const hotRows = bucketRows.filter((row) => getStartState(row) === "hot");
      return {
        timestampMs: bucketStart,
        label: formatter.format(new Date(bucketStart)),
        count: bucketRows.length,
        avgLatencyMs: average(bucketRows.map(getEffectiveLatency)),
        p95LatencyMs: percentile(bucketRows.map(getEffectiveLatency), 0.95),
        coldAvgLatencyMs: coldRows.length > 0 ? average(coldRows.map(getEffectiveLatency)) : null,
        hotAvgLatencyMs: hotRows.length > 0 ? average(hotRows.map(getEffectiveLatency)) : null,
      };
    }),
  };
}

function buildHistogram(rows: PerformanceRow[]) {
  return LATENCY_BANDS.map((band, index) => {
    const previousMax = index === 0 ? 0 : LATENCY_BANDS[index - 1]?.max || 0;
    const bandRows = rows.filter((row) => {
      const latency = getEffectiveLatency(row);
      return latency >= previousMax && latency < band.max;
    });
    return {
      label: band.label,
      count: bandRows.length,
      coldCount: bandRows.filter((row) => getStartState(row) === "cold").length,
      hotCount: bandRows.filter((row) => getStartState(row) === "hot").length,
      unknownCount: bandRows.filter((row) => getStartState(row) === "unknown").length,
      notApplicableCount: bandRows.filter((row) => getStartState(row) === "not-applicable").length,
    };
  });
}

function buildStageBreakdown(rows: PerformanceRow[]) {
  return (["cold", "hot"] as const)
    .map((key) => {
      const stateRows = rows.filter(
        (row) => getStartState(row) === key && hasModelInstrumentation(row),
      );
      const totalEvalCount = stateRows.reduce(
        (sum, row) => sum + Math.max(0, row.modelEvalCount),
        0,
      );
      const totalEvalDurationMs = stateRows.reduce(
        (sum, row) => sum + Math.max(0, row.modelEvalDurationMs),
        0,
      );
      const avgModelTotal = average(
        stateRows.map((row) => Math.max(0, row.modelTotalDurationMs)),
      );
      return {
        key,
        label: START_STATE_LABELS[key],
        count: stateRows.length,
        avgRequestLatencyMs: average(stateRows.map(getEffectiveLatency)),
        avgModelTotalDurationMs: avgModelTotal,
        avgLoadDurationMs: average(stateRows.map((row) => Math.max(0, row.modelLoadDurationMs))),
        avgPromptEvalDurationMs: average(
          stateRows.map((row) => Math.max(0, row.modelPromptEvalDurationMs)),
        ),
        avgEvalDurationMs: average(stateRows.map((row) => Math.max(0, row.modelEvalDurationMs))),
        avgOverheadDurationMs: average(
          stateRows.map((row) => Math.max(0, getEffectiveLatency(row) - Math.max(0, row.modelTotalDurationMs))),
        ),
        tokensPerSecond:
          totalEvalCount > 0 && totalEvalDurationMs > 0
            ? (totalEvalCount / totalEvalDurationMs) * 1000
            : null,
      };
    })
    .filter((row) => row.count > 0);
}

function buildSourceBreakdown(rows: PerformanceRow[]) {
  return groupRows(rows, (row) => row.source || "(unknown source)")
    .map(([source, group]) => ({
      source,
      count: group.length,
      avgLatencyMs: average(group.map(getEffectiveLatency)),
      p95LatencyMs: percentile(group.map(getEffectiveLatency), 0.95),
      coldShare:
        group.filter((row) => row.requestModelName.trim() !== "").length > 0
          ? group.filter((row) => getStartState(row) === "cold").length /
            group.filter((row) => row.requestModelName.trim() !== "").length
          : 0,
    }))
    .sort((left, right) => right.avgLatencyMs - left.avgLatencyMs || right.count - left.count)
    .slice(0, 6);
}

function buildCwdLeaderboard(rows: PerformanceRow[]) {
  return groupRows(rows, (row) => row.cwd || "(no path)")
    .map(([path, group]) => ({
      path,
      count: group.length,
      avgLatencyMs: average(group.map(getEffectiveLatency)),
      p95LatencyMs: percentile(group.map(getEffectiveLatency), 0.95),
      coldShare:
        group.filter((row) => row.requestModelName.trim() !== "").length > 0
          ? group.filter((row) => getStartState(row) === "cold").length /
            group.filter((row) => row.requestModelName.trim() !== "").length
          : 0,
    }))
    .sort((left, right) => right.p95LatencyMs - left.p95LatencyMs || right.count - left.count)
    .slice(0, 6);
}

function buildBufferLeaderboard(rows: PerformanceRow[]) {
  return groupRows(rows, (row) => normalizeBuffer(row.buffer))
    .map(([buffer, group]) => ({
      buffer,
      count: group.length,
      avgLatencyMs: average(group.map(getEffectiveLatency)),
      p95LatencyMs: percentile(group.map(getEffectiveLatency), 0.95),
      coldCount: group.filter((row) => getStartState(row) === "cold").length,
    }))
    .filter((row) => row.count >= 2)
    .sort((left, right) => right.avgLatencyMs - left.avgLatencyMs || right.count - left.count)
    .slice(0, 6);
}

function groupRows(rows: PerformanceRow[], getKey: (row: PerformanceRow) => string) {
  const groups = new Map<string, PerformanceRow[]>();
  for (const row of rows) {
    const key = getKey(row);
    const group = groups.get(key);
    if (group) {
      group.push(row);
      continue;
    }
    groups.set(key, [row]);
  }
  return [...groups.entries()];
}

function normalizeBuffer(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : "(empty buffer)";
}
