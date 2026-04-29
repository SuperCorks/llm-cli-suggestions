import "server-only";

import fs from "node:fs";

import { formatTimestamp } from "@/lib/format";
import { getDb } from "@/lib/server/db";
import { getRuntimeStatus } from "@/lib/server/runtime";
import type {
  ActivitySignal,
  BenchmarkStartState,
  BenchmarkResultRow,
  BenchmarkRunRow,
  CommandRow,
  FeedbackRow,
  OverviewData,
  PagedResult,
  SuggestionOutcome,
  SuggestionQuality,
  SuggestionQualityFilter,
  SuggestionRow,
  SuggestionSort,
} from "@/lib/types";

type QueryValue = string | number;

const prefixGateModelErrorSnippet = "did not begin with the current buffer";

function parseJsonObject(value: unknown) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseBenchmarkEnvironment(value: unknown): BenchmarkRunRow["environment"] {
  const parsed = parseJsonObject(value);
  if (!parsed) {
    return null;
  }
  return {
    hostname: String(parsed.hostname || ""),
    os: String(parsed.os || ""),
    arch: String(parsed.arch || ""),
    goVersion: String(parsed.goVersion || parsed.go_version || ""),
    modelBaseURL: String(parsed.modelBaseURL || parsed.model_base_url || ""),
    modelKeepAlive: String(parsed.modelKeepAlive || parsed.model_keep_alive || ""),
    activeModelName: String(parsed.activeModelName || parsed.active_model_name || ""),
    dbPath: String(parsed.dbPath || parsed.db_path || ""),
  };
}

function parseBenchmarkRunSummary(value: unknown): BenchmarkRunRow["summary"] {
  const parsed = parseJsonObject(value);
  if (!parsed) {
    return null;
  }

  const progressSource =
    parsed.progress && typeof parsed.progress === "object"
      ? (parsed.progress as Record<string, unknown>)
      : {};
  const modelsSource = Array.isArray(parsed.models) ? parsed.models : [];
  const normalizeLatency = (source: Record<string, unknown> | null | undefined) => ({
    count: Number(source?.count || 0),
    mean: Number(source?.mean || 0),
    median: Number(source?.median || 0),
    p90: Number(source?.p90 || 0),
    p95: Number(source?.p95 || 0),
    max: Number(source?.max || 0),
  });
  const normalizeQuality = (source: Record<string, unknown> | null | undefined) => ({
    positiveCaseCount: Number(source?.positiveCaseCount || source?.positive_case_count || 0),
    negativeCaseCount: Number(source?.negativeCaseCount || source?.negative_case_count || 0),
    positiveExactHitRate: Number(source?.positiveExactHitRate || source?.positive_exact_hit_rate || 0),
    negativeAvoidRate: Number(source?.negativeAvoidRate || source?.negative_avoid_rate || 0),
    validWinnerRate: Number(source?.validWinnerRate || source?.valid_winner_rate || 0),
    candidateRecallAt3: Number(source?.candidateRecallAt3 || source?.candidate_recall_at_3 || 0),
    charsSavedRatio: Number(source?.charsSavedRatio || source?.chars_saved_ratio || 0),
  });
  const normalizeAggregate = (source: Record<string, unknown> | null | undefined) => {
    const startStates = Array.isArray(source?.startStates || source?.start_states)
      ? ((source?.startStates || source?.start_states) as Array<Record<string, unknown>>)
      : [];
    const stages = Array.isArray(source?.stages) ? (source?.stages as Array<Record<string, unknown>>) : [];
    const budgetPassRates = Array.isArray(source?.budgetPassRates || source?.budget_pass_rates)
      ? ((source?.budgetPassRates || source?.budget_pass_rates) as Array<Record<string, unknown>>)
      : [];
    const categoryBreakdown = Array.isArray(source?.categoryBreakdown || source?.category_breakdown)
      ? ((source?.categoryBreakdown || source?.category_breakdown) as Array<Record<string, unknown>>)
      : [];
    const repoBreakdown = Array.isArray(source?.repoBreakdown || source?.repo_breakdown)
      ? ((source?.repoBreakdown || source?.repo_breakdown) as Array<Record<string, unknown>>)
      : [];
    const sourceBreakdown = Array.isArray(source?.sourceBreakdown || source?.source_breakdown)
      ? ((source?.sourceBreakdown || source?.source_breakdown) as Array<Record<string, unknown>>)
      : [];
    const normalizeBucket = (bucket: Record<string, unknown>) => ({
      key: String(bucket.key || ""),
      label: String(bucket.label || ""),
      count: Number(bucket.count || 0),
      share: Number(bucket.share || 0),
      quality: normalizeQuality(bucket.quality as Record<string, unknown>),
      latency: normalizeLatency(bucket.latency as Record<string, unknown>),
    });
    return {
      count: Number(source?.count || 0),
      quality: normalizeQuality(source?.quality as Record<string, unknown>),
      latency: normalizeLatency(source?.latency as Record<string, unknown>),
      startStates: startStates.map((state) => ({
        key: String(state.key || "unknown") as BenchmarkStartState,
        count: Number(state.count || 0),
        share: Number(state.share || 0),
        latency: normalizeLatency(state.latency as Record<string, unknown>),
      })),
      coldPenaltyMs: Number(source?.coldPenaltyMs || source?.cold_penalty_ms || 0),
      stages: stages.map((stage) => ({
        label: String(stage.label || ""),
        count: Number(stage.count || 0),
        avgRequestLatencyMs: Number(stage.avgRequestLatencyMs || stage.avg_request_latency_ms || 0),
        avgModelTotalDurationMs: Number(stage.avgModelTotalDurationMs || stage.avg_model_total_duration_ms || 0),
        avgLoadDurationMs: Number(stage.avgLoadDurationMs || stage.avg_load_duration_ms || 0),
        avgPromptEvalDurationMs: Number(stage.avgPromptEvalDurationMs || stage.avg_prompt_eval_duration_ms || 0),
        avgEvalDurationMs: Number(stage.avgEvalDurationMs || stage.avg_eval_duration_ms || 0),
        avgNonModelOverheadMs: Number(stage.avgNonModelOverheadMs || stage.avg_non_model_overhead_ms || 0),
        decodeTokensPerSecond: Number(stage.decodeTokensPerSecond || stage.decode_tokens_per_second || 0),
      })),
      budgetPassRates: budgetPassRates.map((entry) => ({
        budgetMs: Number(entry.budgetMs || entry.budget_ms || 0),
        rate: Number(entry.rate || 0),
      })),
      repoBreakdown: repoBreakdown.map(normalizeBucket),
      categoryBreakdown: categoryBreakdown.map(normalizeBucket),
      sourceBreakdown: sourceBreakdown.map(normalizeBucket),
    };
  };

  return {
    progress: {
      completed: Number(progressSource.completed || 0),
      total: Number(progressSource.total || 0),
      percent: Number(progressSource.percent || 0),
      status: String(progressSource.status || ""),
      currentModel: String(progressSource.currentModel || progressSource.current_model || ""),
      currentCase: String(progressSource.currentCase || progressSource.current_case || ""),
      currentRun: Number(progressSource.currentRun || progressSource.current_run || 0),
      currentPhase: String(progressSource.currentPhase || progressSource.current_phase || ""),
    },
    track: String(parsed.track || "static") as BenchmarkRunRow["track"],
    surface: String(parsed.surface || "end_to_end") as BenchmarkRunRow["surface"],
    suiteName: String(parsed.suiteName || parsed.suite_name || ""),
    strategy: String(parsed.strategy || ""),
    timingProtocol: String(parsed.timingProtocol || parsed.timing_protocol || "full") as BenchmarkRunRow["timingProtocol"],
    datasetSize: Number(parsed.datasetSize || parsed.dataset_size || 0),
    positiveCaseCount: Number(parsed.positiveCaseCount || parsed.positive_case_count || 0),
    negativeCaseCount: Number(parsed.negativeCaseCount || parsed.negative_case_count || 0),
    overall: normalizeAggregate(parsed.overall as Record<string, unknown>),
    models: modelsSource.map((entry) => {
      const modelEntry = entry as Record<string, unknown>;
      return {
        model: String(modelEntry.model || ""),
        overall: normalizeAggregate(modelEntry.overall as Record<string, unknown>),
        cold: normalizeAggregate(modelEntry.cold as Record<string, unknown>),
        hot: normalizeAggregate(modelEntry.hot as Record<string, unknown>),
      };
    }),
  };
}

function readBenchmarkArtifact(outputJsonPath: string) {
  if (!outputJsonPath || !fs.existsSync(outputJsonPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(outputJsonPath, "utf8")) as Record<string, unknown>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractBenchmarkRunError(logText: string) {
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

function getArtifactProgressStatus(artifact: Record<string, unknown> | null) {
  const summary = artifact?.summary;
  if (!summary || typeof summary !== "object") {
    return "";
  }
  const progress = (summary as Record<string, unknown>).progress;
  if (!progress || typeof progress !== "object") {
    return "";
  }
  return String((progress as Record<string, unknown>).status || "").trim().toLowerCase();
}

function reconcileBenchmarkRuns() {
  const db = getDb();
  const staleRuns = db
    .prepare(
      `SELECT
         id,
         status,
         output_json_path AS outputJsonPath,
         log_text AS logText,
         summary_json AS summaryJson,
         error_text AS errorText,
         finished_at_ms AS finishedAtMs,
         last_event_at_ms AS lastEventAtMs
       FROM benchmark_runs
       WHERE status IN ('queued', 'running')`,
    )
    .all() as Array<{
      id: number;
      status: string;
      outputJsonPath: string;
      logText: string;
      summaryJson: string;
      errorText: string;
      finishedAtMs: number;
      lastEventAtMs: number;
    }>;

  const updateRun = db.prepare(
    `UPDATE benchmark_runs
     SET status = ?,
         summary_json = COALESCE(?, summary_json),
         error_text = ?,
         finished_at_ms = CASE WHEN finished_at_ms > 0 THEN finished_at_ms ELSE ? END
     WHERE id = ?`,
  );

  for (const run of staleRuns) {
    const artifact = readBenchmarkArtifact(run.outputJsonPath);
    const artifactSummary =
      artifact?.summary && typeof artifact.summary === "object"
        ? (artifact.summary as Record<string, unknown>)
        : null;
    const artifactStatus = getArtifactProgressStatus(artifact);
    const loggedError = extractBenchmarkRunError(run.logText || "");

    let nextStatus = "";
    if (artifactStatus === "failed" || artifactStatus === "completed") {
      nextStatus = artifactStatus;
    } else if (loggedError) {
      nextStatus = "failed";
    } else if ((run.logText || "").includes("[completed]")) {
      nextStatus = "completed";
    }

    if (!nextStatus) {
      continue;
    }

    updateRun.run(
      nextStatus,
      artifactSummary ? JSON.stringify(artifactSummary) : null,
      nextStatus === "failed" ? run.errorText || loggedError || "benchmark run failed" : "",
      run.finishedAtMs > 0 ? run.finishedAtMs : run.lastEventAtMs || Date.now(),
      run.id,
    );
  }
}

function buildWhere(clauses: string[]) {
  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

function normalizeLike(value?: string) {
  if (!value) {
    return "";
  }
  return `%${value.trim()}%`;
}

function mapSuggestionToActivitySignal(row: SuggestionRow): ActivitySignal {
  const tone =
    row.outcome === "accepted"
      ? "accepted"
      : row.outcome === "edited"
        ? "edited"
        : row.outcome === "rejected"
          ? "rejected"
          : "observed";
  const label =
    row.outcome === "accepted"
      ? "ACCEPT"
      : row.outcome === "edited"
        ? "EDIT"
        : row.outcome === "rejected"
          ? "REJECT"
          : row.outcome === "buffered"
            ? "BUFFER"
            : "TRACE";
  return {
    id: row.id,
    timestamp: formatTimestamp(row.createdAtMs),
    tone,
    label,
    message: `${row.source} suggestion for ${row.buffer || "empty buffer"}`,
  };
}

export function listSuggestions(input: {
  page?: number;
  pageSize?: number;
  source?: string;
  model?: string;
  session?: string;
  cwd?: string;
  repo?: string;
  query?: string;
  outcome?: SuggestionOutcome;
  quality?: SuggestionQualityFilter;
  sort?: SuggestionSort;
  showPrefixRejected?: boolean;
  returnedToShellOnly?: boolean;
}): PagedResult<SuggestionRow> {
  const db = getDb();
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.max(1, Math.min(100, input.pageSize || 25));
  const offset = (page - 1) * pageSize;
  const params: QueryValue[] = [];
  const clauses: string[] = [];

  if (input.source) {
    clauses.push("s.source = ?");
    params.push(input.source);
  }
  if (input.model) {
    clauses.push("(s.request_model_name = ? OR (TRIM(s.request_model_name) = '' AND s.model_name = ?))");
    params.push(input.model, input.model);
  }
  if (input.session) {
    clauses.push("s.session_id = ?");
    params.push(input.session);
  }
  if (input.cwd) {
    clauses.push("s.cwd LIKE ?");
    params.push(normalizeLike(input.cwd));
  }
  if (input.repo) {
    clauses.push("s.repo_root LIKE ?");
    params.push(normalizeLike(input.repo));
  }
  if (input.query) {
    clauses.push(
      "(s.buffer LIKE ? OR s.suggestion_text LIKE ? OR COALESCE(f.accepted_command, '') LIKE ? OR COALESCE(f.actual_command, '') LIKE ?)",
    );
    params.push(
      normalizeLike(input.query),
      normalizeLike(input.query),
      normalizeLike(input.query),
      normalizeLike(input.query),
    );
  }
  if (input.outcome === "accepted") {
    clauses.push("COALESCE(f.executed_unchanged, 0) = 1");
  } else if (input.outcome === "edited") {
    clauses.push("COALESCE(f.executed_edited, 0) = 1");
  } else if (input.outcome === "buffered") {
    clauses.push(
      "COALESCE(f.accepted_buffer, 0) = 1 AND COALESCE(f.executed_unchanged, 0) = 0 AND COALESCE(f.executed_edited, 0) = 0 AND COALESCE(f.rejected, 0) = 0",
    );
  } else if (input.outcome === "rejected") {
    clauses.push("COALESCE(f.rejected, 0) = 1");
  } else if (input.outcome === "unreviewed") {
    clauses.push(
      "COALESCE(f.accepted_buffer, 0) = 0 AND COALESCE(f.executed_unchanged, 0) = 0 AND COALESCE(f.executed_edited, 0) = 0 AND COALESCE(f.rejected, 0) = 0",
    );
  }
  if (input.quality === "good" || input.quality === "bad") {
    clauses.push("COALESCE(r.review_label, '') = ?");
    params.push(input.quality);
  } else if (input.quality === "unlabeled") {
    clauses.push("COALESCE(r.review_label, '') = ''");
  }
  if (input.returnedToShellOnly) {
    clauses.push("COALESCE(s.returned_to_shell, 0) = 1");
  }
  if (!input.showPrefixRejected) {
    clauses.push("COALESCE(s.model_error, '') NOT LIKE ?");
    params.push(`%${prefixGateModelErrorSnippet}%`);
  }

  const where = buildWhere(clauses);
  const orderBy = getSuggestionOrderBy(input.sort);
  const fromClause = `
    FROM suggestions s
    LEFT JOIN (
      SELECT
        suggestion_id,
        MAX(CASE WHEN event_type = 'accepted_buffer' THEN 1 ELSE 0 END) AS accepted_buffer,
        MAX(CASE WHEN event_type IN ('executed_unchanged', 'accepted') THEN 1 ELSE 0 END) AS executed_unchanged,
        MAX(CASE WHEN event_type = 'executed_edited' THEN 1 ELSE 0 END) AS executed_edited,
        MAX(CASE WHEN event_type = 'rejected' THEN 1 ELSE 0 END) AS rejected,
        MAX(
          CASE
            WHEN event_type IN ('accepted_buffer', 'executed_unchanged', 'executed_edited', 'accepted')
            THEN accepted_command
            ELSE ''
          END
        ) AS accepted_command,
        MAX(
          CASE
            WHEN event_type IN ('executed_unchanged', 'executed_edited', 'rejected')
            THEN actual_command
            ELSE ''
          END
        ) AS actual_command
      FROM feedback_events
      GROUP BY suggestion_id
    ) f ON f.suggestion_id = s.id
    LEFT JOIN suggestion_reviews r ON r.suggestion_id = s.id
  `;

  const total = Number(
    db.prepare(`SELECT COUNT(*) ${fromClause} ${where}`).pluck().get(...params) || 0,
  );

  const rows = db
    .prepare(
      `SELECT
         s.id,
         s.session_id AS sessionId,
         s.buffer,
         s.suggestion_text AS suggestionText,
         s.source,
         s.cwd,
         s.repo_root AS repoRoot,
         s.branch,
         s.last_exit_code AS lastExitCode,
         s.model_name AS modelName,
         COALESCE(s.request_model_name, '') AS requestModelName,
         COALESCE(s.request_id, '') AS requestId,
         COALESCE(s.attempt_index, 0) AS attemptIndex,
         COALESCE(s.returned_to_shell, 0) = 1 AS returnedToShell,
         COALESCE(s.validation_state, 'skipped') AS validationState,
         COALESCE(s.validation_failures_json, '') AS validationFailuresJson,
         CASE
           WHEN s.request_latency_ms > 0 THEN s.request_latency_ms
           ELSE s.latency_ms
         END AS latencyMs,
         s.created_at_ms AS createdAtMs,
         CASE
           WHEN COALESCE(f.executed_edited, 0) = 1 THEN 'edited'
           WHEN COALESCE(f.executed_unchanged, 0) = 1 THEN 'accepted'
           WHEN COALESCE(f.rejected, 0) = 1 THEN 'rejected'
           WHEN COALESCE(f.accepted_buffer, 0) = 1 THEN 'buffered'
           ELSE 'unreviewed'
         END AS outcome,
         COALESCE(f.executed_unchanged, 0) AS accepted,
         COALESCE(f.executed_edited, 0) AS edited,
         COALESCE(f.accepted_buffer, 0) AS buffered,
         COALESCE(f.rejected, 0) AS rejected,
         CASE
           WHEN COALESCE(f.executed_edited, 0) = 1 THEN 'executed_edited'
           WHEN COALESCE(f.executed_unchanged, 0) = 1 THEN 'executed_unchanged'
           WHEN COALESCE(f.rejected, 0) = 1 THEN 'rejected'
           WHEN COALESCE(f.accepted_buffer, 0) = 1 THEN 'accepted_buffer'
           ELSE ''
         END AS outcomeEventType,
         COALESCE(f.accepted_command, '') AS acceptedCommand,
         COALESCE(f.actual_command, '') AS actualCommand,
         COALESCE(s.prompt_text, '') AS promptText,
         COALESCE(s.structured_context_json, '') AS structuredContextJson,
         COALESCE(s.model_error, '') AS modelError,
         NULLIF(COALESCE(r.review_label, ''), '') AS qualityLabel,
         COALESCE(r.updated_at_ms, 0) AS qualityUpdatedAtMs
       ${fromClause}
       ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset) as SuggestionRow[];

  return { total, page, pageSize, rows };
}

export function getRecentActivitySignals(limit = 6) {
  return listSuggestions({
    page: 1,
    pageSize: limit,
    outcome: "all",
    returnedToShellOnly: true,
  }).rows.map(mapSuggestionToActivitySignal);
}

export function listSuggestionSources() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT source
       FROM suggestions
       WHERE TRIM(source) <> ''
       ORDER BY source ASC`,
    )
    .all() as Array<{ source: string }>;

  return rows.map((row) => row.source).filter(Boolean);
}

export function listSuggestionModels() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT model
       FROM (
         SELECT model_name AS model FROM suggestions WHERE TRIM(model_name) <> ''
         UNION
         SELECT request_model_name AS model FROM suggestions WHERE TRIM(request_model_name) <> ''
       )
       ORDER BY model ASC`,
    )
    .all() as Array<{ model: string }>;

  return rows.map((row) => row.model).filter(Boolean);
}

function getSuggestionOrderBy(sort?: SuggestionSort) {
  switch (sort) {
    case "oldest":
      return "s.created_at_ms ASC, s.id ASC";
    case "latency-desc":
      return "CASE WHEN s.request_latency_ms > 0 THEN s.request_latency_ms ELSE s.latency_ms END DESC, s.created_at_ms DESC";
    case "latency-asc":
      return "CASE WHEN s.request_latency_ms > 0 THEN s.request_latency_ms ELSE s.latency_ms END ASC, s.created_at_ms DESC";
    case "buffer-asc":
      return "s.buffer ASC, s.created_at_ms DESC";
    case "model-asc":
      return "CASE WHEN TRIM(CASE WHEN TRIM(s.request_model_name) <> '' THEN s.request_model_name ELSE s.model_name END) = '' THEN 1 ELSE 0 END, CASE WHEN TRIM(s.request_model_name) <> '' THEN s.request_model_name ELSE s.model_name END ASC, s.created_at_ms DESC";
    case "quality-desc":
      return "CASE COALESCE(r.review_label, '') WHEN 'good' THEN 0 WHEN 'bad' THEN 1 ELSE 2 END, s.created_at_ms DESC";
    case "newest":
    default:
      return "s.created_at_ms DESC";
  }
}

export function setSuggestionReview(suggestionId: number, label: SuggestionQuality | null) {
  const db = getDb();
  if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
    throw new Error("invalid suggestion id");
  }

  const exists = db
    .prepare("SELECT 1 FROM suggestions WHERE id = ?")
    .pluck()
    .get(suggestionId);
  if (!exists) {
    throw new Error("suggestion not found");
  }

  if (!label) {
    db.prepare("DELETE FROM suggestion_reviews WHERE suggestion_id = ?").run(suggestionId);
    return { suggestionId, qualityLabel: null, qualityUpdatedAtMs: 0 };
  }

  const updatedAtMs = Date.now();
  db.prepare(
    `INSERT INTO suggestion_reviews(suggestion_id, review_label, updated_at_ms)
     VALUES(?, ?, ?)
     ON CONFLICT(suggestion_id) DO UPDATE SET
       review_label = excluded.review_label,
       updated_at_ms = excluded.updated_at_ms`,
  ).run(suggestionId, label, updatedAtMs);

  return { suggestionId, qualityLabel: label, qualityUpdatedAtMs: updatedAtMs };
}

export function listCommands(input: {
  page?: number;
  pageSize?: number;
  session?: string;
  cwd?: string;
  repo?: string;
  query?: string;
}): PagedResult<CommandRow> {
  const db = getDb();
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.max(1, Math.min(100, input.pageSize || 25));
  const offset = (page - 1) * pageSize;
  const params: QueryValue[] = [];
  const clauses: string[] = [];

  if (input.session) {
    clauses.push("session_id = ?");
    params.push(input.session);
  }
  if (input.cwd) {
    clauses.push("cwd LIKE ?");
    params.push(normalizeLike(input.cwd));
  }
  if (input.repo) {
    clauses.push("repo_root LIKE ?");
    params.push(normalizeLike(input.repo));
  }
  if (input.query) {
    clauses.push("(command_text LIKE ? OR stdout_excerpt LIKE ? OR stderr_excerpt LIKE ?)");
    params.push(
      normalizeLike(input.query),
      normalizeLike(input.query),
      normalizeLike(input.query),
    );
  }

  const where = buildWhere(clauses);
  const total = Number(
    db.prepare(`SELECT COUNT(*) FROM commands ${where}`).pluck().get(...params) || 0,
  );

  const rows = db
    .prepare(
      `SELECT
         id,
         session_id AS sessionId,
         command_text AS commandText,
         cwd,
         repo_root AS repoRoot,
         branch,
         exit_code AS exitCode,
         duration_ms AS durationMs,
         started_at_ms AS startedAtMs,
         finished_at_ms AS finishedAtMs,
         stdout_excerpt AS stdoutExcerpt,
         stderr_excerpt AS stderrExcerpt
       FROM commands
       ${where}
       ORDER BY finished_at_ms DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset) as CommandRow[];

  return { total, page, pageSize, rows };
}

export function deleteCommandsByExactText(commandText: string) {
  if (!commandText.trim()) {
    throw new Error("command text is required");
  }

  const db = getDb();
  const result = db.prepare("DELETE FROM commands WHERE command_text = ?").run(commandText);
  return Number(result.changes || 0);
}

export function getFeedbackSummary() {
  return getFeedbackSummaryFiltered({});
}

export function getFeedbackSummaryFiltered(input: {
  session?: string;
  cwd?: string;
  repo?: string;
  query?: string;
}) {
  const db = getDb();
  const params: QueryValue[] = [];
  const clauses: string[] = [];

  if (input.session) {
    clauses.push("s.session_id = ?");
    params.push(input.session);
  }
  if (input.cwd) {
    clauses.push("s.cwd LIKE ?");
    params.push(normalizeLike(input.cwd));
  }
  if (input.repo) {
    clauses.push("s.repo_root LIKE ?");
    params.push(normalizeLike(input.repo));
  }
  if (input.query) {
    clauses.push(
      "(s.buffer LIKE ? OR s.suggestion_text LIKE ? OR fe.accepted_command LIKE ? OR fe.actual_command LIKE ?)",
    );
    params.push(
      normalizeLike(input.query),
      normalizeLike(input.query),
      normalizeLike(input.query),
      normalizeLike(input.query),
    );
  }

  const where = buildWhere(clauses);
  const fromClause = `
    FROM feedback_events fe
    INNER JOIN suggestions s ON s.id = fe.suggestion_id
    ${where}
  `;

  const recentFeedback = db
    .prepare(
      `SELECT
         fe.id,
         fe.suggestion_id AS suggestionId,
         s.session_id AS sessionId,
         fe.event_type AS eventType,
         fe.buffer,
         fe.suggestion_text AS suggestionText,
         fe.accepted_command AS acceptedCommand,
         fe.actual_command AS actualCommand,
         fe.created_at_ms AS createdAtMs
       ${fromClause}
       ORDER BY fe.created_at_ms DESC
       LIMIT 25`,
    )
    .all(...params) as FeedbackRow[];

  const topRejectedSuggestions = db
    .prepare(
      `SELECT fe.suggestion_text AS suggestion, COUNT(*) AS count
       ${fromClause}
       ${where ? "AND" : "WHERE"} fe.event_type = 'rejected'
       GROUP BY fe.suggestion_text
       ORDER BY count DESC, MAX(fe.created_at_ms) DESC
       LIMIT 10`,
    )
    .all(...params) as Array<{ suggestion: string; count: number }>;

  const acceptanceByPath = db
    .prepare(
      `SELECT
          CASE WHEN s.cwd = '' THEN '(no path)' ELSE s.cwd END AS path,
          SUM(CASE WHEN fe.event_type IN ('accepted', 'executed_unchanged') THEN 1 ELSE 0 END) AS accepted,
          SUM(CASE WHEN fe.event_type = 'executed_edited' THEN 1 ELSE 0 END) AS edited,
          SUM(CASE WHEN fe.event_type = 'rejected' THEN 1 ELSE 0 END) AS rejected
       ${fromClause}
       GROUP BY path
       HAVING accepted + edited + rejected > 0
       ORDER BY accepted DESC, edited DESC, rejected DESC, path ASC
       LIMIT 12`,
    )
    .all(...params)
    .map((row) => {
      const parsed = row as Record<string, unknown>;
      const accepted = Number(parsed.accepted || 0);
      const edited = Number(parsed.edited || 0);
      const rejected = Number(parsed.rejected || 0);
      return {
        path: String(parsed.path || ""),
        accepted,
        edited,
        rejected,
        acceptanceRate: accepted / Math.max(1, accepted + edited + rejected),
      };
    });

  return { recentFeedback, topRejectedSuggestions, acceptanceByPath };
}

export function listBenchmarkRuns(limit = 20): BenchmarkRunRow[] {
  reconcileBenchmarkRuns();
  const db = getDb();
  return db
    .prepare(
      `SELECT
         id,
         status,
         track,
         surface,
         suite_name AS suiteName,
         strategy,
         timing_protocol AS timingProtocol,
         models,
         repeat_count AS repeatCount,
         timeout_ms AS timeoutMs,
         filters_json AS filtersJson,
         dataset_size AS datasetSize,
         environment_json AS environmentJson,
         output_json_path AS outputJsonPath,
         summary_json AS summaryJson,
         log_text AS logText,
         last_event_at_ms AS lastEventAtMs,
         error_text AS errorText,
         created_at_ms AS createdAtMs,
         started_at_ms AS startedAtMs,
         finished_at_ms AS finishedAtMs
       FROM benchmark_runs
       ORDER BY created_at_ms DESC
       LIMIT ?`,
    )
    .all(limit)
    .map((row) => {
      const parsed = row as Record<string, unknown>;
      return {
        id: Number(parsed.id),
        status: String(parsed.status),
        track: String(parsed.track || "static") as BenchmarkRunRow["track"],
        surface: String(parsed.surface || "end_to_end") as BenchmarkRunRow["surface"],
        suiteName: String(parsed.suiteName || ""),
        strategy: String(parsed.strategy || ""),
        timingProtocol: String(parsed.timingProtocol || "full") as BenchmarkRunRow["timingProtocol"],
        models: String(parsed.models || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        repeatCount: Number(parsed.repeatCount || 0),
        timeoutMs: Number(parsed.timeoutMs || 0),
        filtersJson: String(parsed.filtersJson || ""),
        datasetSize: Number(parsed.datasetSize || 0),
        environment: parseBenchmarkEnvironment(parsed.environmentJson),
        outputJsonPath: String(parsed.outputJsonPath || ""),
        summary: parseBenchmarkRunSummary(parsed.summaryJson),
        logText: String(parsed.logText || ""),
        lastEventAtMs: Number(parsed.lastEventAtMs || 0),
        errorText: String(parsed.errorText || ""),
        createdAtMs: Number(parsed.createdAtMs || 0),
        startedAtMs: Number(parsed.startedAtMs || 0),
        finishedAtMs: Number(parsed.finishedAtMs || 0),
      };
    });
}

export function getBenchmarkRun(runId: number) {
  const run = listBenchmarkRuns(100).find((item) => item.id === runId) || null;
  if (!run) {
    return null;
  }

  const db = getDb();
  const results = db
    .prepare(
      `SELECT
         id,
         run_id AS runId,
         model_name AS modelName,
         track,
         surface,
         suite_name AS suiteName,
         strategy,
         timing_protocol AS timingProtocol,
         timing_phase AS timingPhase,
         start_state AS startState,
         case_id AS caseId,
         case_name AS caseName,
         category,
         tags_json AS tagsJson,
         label_kind AS labelKind,
         run_number AS runNumber,
         request_json AS requestJson,
         expected_command AS expectedCommand,
         expected_alternatives_json AS expectedAlternativesJson,
         negative_target AS negativeTarget,
         winner_command AS winnerCommand,
         winner_source AS winnerSource,
         candidates_json AS candidatesJson,
         raw_model_output AS rawModelOutput,
         cleaned_model_output AS cleanedModelOutput,
         exact_match AS exactMatch,
         alternative_match AS alternativeMatch,
         negative_avoided AS negativeAvoided,
         valid_prefix AS validPrefix,
         candidate_hit_at_3 AS candidateHitAt3,
         chars_saved_ratio AS charsSavedRatio,
         command_edit_distance AS commandEditDistance,
         request_latency_ms AS requestLatencyMs,
         model_total_duration_ms AS modelTotalDurationMs,
         model_load_duration_ms AS modelLoadDurationMs,
         model_prompt_eval_duration_ms AS modelPromptEvalDurationMs,
         model_eval_duration_ms AS modelEvalDurationMs,
         model_prompt_eval_count AS modelPromptEvalCount,
         model_eval_count AS modelEvalCount,
         decode_tokens_per_second AS decodeTokensPerSecond,
         non_model_overhead_duration_ms AS nonModelOverheadDurationMs,
         model_error AS modelError,
         error_text AS errorText,
         replay_source_json AS replaySourceJson,
         created_at_ms AS createdAtMs
       FROM benchmark_results
       WHERE run_id = ?
       ORDER BY model_name ASC, case_name ASC, run_number ASC`,
    )
    .all(runId)
    .map((row) => {
      const parsed = row as Record<string, unknown>;
      return {
        id: Number(parsed.id),
        runId: Number(parsed.runId),
        modelName: String(parsed.modelName || ""),
        track: String(parsed.track || "static") as BenchmarkResultRow["track"],
        surface: String(parsed.surface || "end_to_end") as BenchmarkResultRow["surface"],
        suiteName: String(parsed.suiteName || ""),
        strategy: String(parsed.strategy || ""),
        timingProtocol: String(parsed.timingProtocol || "full") as BenchmarkResultRow["timingProtocol"],
        timingPhase: String(parsed.timingPhase || "mixed") as BenchmarkResultRow["timingPhase"],
        startState: String(parsed.startState || "unknown") as BenchmarkResultRow["startState"],
        caseId: String(parsed.caseId || ""),
        caseName: String(parsed.caseName || ""),
        category: String(parsed.category || ""),
        tags: parsed.tagsJson ? JSON.parse(String(parsed.tagsJson)) : [],
        labelKind: String(parsed.labelKind || "positive") as BenchmarkResultRow["labelKind"],
        runNumber: Number(parsed.runNumber || 0),
        requestJson: String(parsed.requestJson || ""),
        expectedCommand: String(parsed.expectedCommand || ""),
        expectedAlternatives: parsed.expectedAlternativesJson
          ? JSON.parse(String(parsed.expectedAlternativesJson))
          : [],
        negativeTarget: String(parsed.negativeTarget || ""),
        winnerCommand: String(parsed.winnerCommand || ""),
        winnerSource: String(parsed.winnerSource || ""),
        candidatesJson: String(parsed.candidatesJson || ""),
        rawModelOutput: String(parsed.rawModelOutput || ""),
        cleanedModelOutput: String(parsed.cleanedModelOutput || ""),
        exactMatch: Number(parsed.exactMatch || 0) === 1,
        alternativeMatch: Number(parsed.alternativeMatch || 0) === 1,
        negativeAvoided: Number(parsed.negativeAvoided || 0) === 1,
        validPrefix: Number(parsed.validPrefix || 0) === 1,
        candidateHitAt3: Number(parsed.candidateHitAt3 || 0) === 1,
        charsSavedRatio: Number(parsed.charsSavedRatio || 0),
        commandEditDistance: Number(parsed.commandEditDistance || 0),
        requestLatencyMs: Number(parsed.requestLatencyMs || 0),
        modelTotalDurationMs: Number(parsed.modelTotalDurationMs || 0),
        modelLoadDurationMs: Number(parsed.modelLoadDurationMs || 0),
        modelPromptEvalDurationMs: Number(parsed.modelPromptEvalDurationMs || 0),
        modelEvalDurationMs: Number(parsed.modelEvalDurationMs || 0),
        modelPromptEvalCount: Number(parsed.modelPromptEvalCount || 0),
        modelEvalCount: Number(parsed.modelEvalCount || 0),
        decodeTokensPerSecond: Number(parsed.decodeTokensPerSecond || 0),
        nonModelOverheadDurationMs: Number(parsed.nonModelOverheadDurationMs || 0),
        modelError: String(parsed.modelError || ""),
        errorText: String(parsed.errorText || ""),
        replaySourceJson: String(parsed.replaySourceJson || ""),
        createdAtMs: Number(parsed.createdAtMs || 0),
      } satisfies BenchmarkResultRow;
    });

  return { run, results };
}

export function deleteBenchmarkRun(runId: number) {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT
         id,
         status,
         output_json_path AS outputJsonPath
       FROM benchmark_runs
       WHERE id = ?`,
    )
    .get(runId) as
    | {
        id: number;
        status: string;
        outputJsonPath: string;
      }
    | undefined;

  if (!existing) {
    return { ok: false as const, reason: "not_found" as const };
  }

  if (existing.status === "queued" || existing.status === "running") {
    return {
      ok: false as const,
      reason: "active" as const,
      status: existing.status,
    };
  }

  const removeRun = db.transaction((targetRunId: number) => {
    db.prepare("DELETE FROM benchmark_results WHERE run_id = ?").run(targetRunId);
    db.prepare("DELETE FROM benchmark_runs WHERE id = ?").run(targetRunId);
  });

  removeRun(runId);

  if (existing.outputJsonPath) {
    fs.rmSync(existing.outputJsonPath, { force: true });
  }

  return { ok: true as const, deletedRunId: runId };
}

export function clearDataset(kind: "suggestions" | "feedback" | "benchmarks") {
  const db = getDb();
  if (kind === "suggestions") {
    db.exec("DELETE FROM feedback_events; DELETE FROM suggestions;");
    return;
  }
  if (kind === "feedback") {
    db.exec("DELETE FROM feedback_events;");
    return;
  }
  db.exec("DELETE FROM benchmark_results; DELETE FROM benchmark_runs;");
}

export function exportRows(dataset: "suggestions" | "commands" | "benchmarks") {
  const db = getDb();
  if (dataset === "suggestions") {
    return db
      .prepare(
        `SELECT
           s.id,
           s.session_id AS session_id,
           s.buffer,
           s.suggestion_text,
           s.source,
           s.cwd,
           s.repo_root,
           s.branch,
           s.model_name,
           s.latency_ms,
           s.request_latency_ms,
           s.request_model_name,
           s.model_keep_alive,
           s.model_start_state,
           s.model_total_duration_ms,
           s.model_load_duration_ms,
           s.model_prompt_eval_duration_ms,
           s.model_eval_duration_ms,
           s.model_prompt_eval_count,
           s.model_eval_count,
           s.request_id,
           s.attempt_index,
           s.returned_to_shell,
           s.validation_state,
           s.validation_failures_json,
           s.created_at_ms,
           GROUP_CONCAT(DISTINCT fe.event_type) AS feedback_events,
           MAX(fe.accepted_command) AS accepted_command,
           MAX(fe.actual_command) AS actual_command
         FROM suggestions s
         LEFT JOIN feedback_events fe ON fe.suggestion_id = s.id
         GROUP BY s.id
         ORDER BY s.created_at_ms DESC`,
      )
      .all() as Record<string, unknown>[];
  }
  if (dataset === "commands") {
    return db
      .prepare(
        `SELECT
           id,
           session_id,
           command_text,
           cwd,
           repo_root,
           branch,
           exit_code,
           duration_ms,
           started_at_ms,
           finished_at_ms,
           stdout_excerpt,
           stderr_excerpt
         FROM commands
         ORDER BY finished_at_ms DESC`,
      )
      .all() as Record<string, unknown>[];
  }
  return db
    .prepare(
      `SELECT
         r.id AS run_id,
         r.status,
         r.track,
         r.surface,
         r.suite_name,
         r.strategy,
         r.timing_protocol,
         r.models,
         r.repeat_count,
         r.timeout_ms,
         r.dataset_size,
         r.created_at_ms,
         r.started_at_ms,
         r.finished_at_ms,
         r.error_text,
         br.model_name,
         br.case_id,
         br.case_name,
         br.category,
         br.label_kind,
         br.run_number,
         br.request_latency_ms,
         br.winner_command,
         br.winner_source,
         br.valid_prefix,
         br.exact_match,
         br.alternative_match,
         br.negative_avoided,
         br.error_text AS result_error_text
       FROM benchmark_runs r
       LEFT JOIN benchmark_results br ON br.run_id = r.id
       ORDER BY r.created_at_ms DESC, br.model_name ASC, br.case_name ASC`,
    )
    .all() as Record<string, unknown>[];
}

export function getOverviewData(): OverviewData {
  const db = getDb();
  const feedbackSummary = getFeedbackSummary();
  const totals = {
    sessions: Number(db.prepare("SELECT COUNT(*) FROM sessions").pluck().get() || 0),
    commands: Number(db.prepare("SELECT COUNT(*) FROM commands").pluck().get() || 0),
    suggestions: Number(
      db.prepare("SELECT COUNT(*) FROM suggestions WHERE COALESCE(returned_to_shell, 0) = 1").pluck().get() || 0,
    ),
    accepted: Number(
      db
        .prepare("SELECT COUNT(*) FROM feedback_events WHERE event_type IN ('accepted', 'executed_unchanged')")
        .pluck()
        .get() || 0,
    ),
    edited: Number(
      db
        .prepare("SELECT COUNT(*) FROM feedback_events WHERE event_type = 'executed_edited'")
        .pluck()
        .get() || 0,
    ),
    buffered: Number(
      db
        .prepare("SELECT COUNT(*) FROM feedback_events WHERE event_type = 'accepted_buffer'")
        .pluck()
        .get() || 0,
    ),
    rejected: Number(
      db
        .prepare("SELECT COUNT(*) FROM feedback_events WHERE event_type = 'rejected'")
        .pluck()
        .get() || 0,
    ),
  };

  const averageModelLatency = Number(
    db
      .prepare(
        `SELECT COALESCE(
           AVG(
             CASE
               WHEN request_latency_ms > 0 THEN request_latency_ms
               WHEN latency_ms > 0 THEN latency_ms
             END
           ),
           0
         ) FROM suggestions
         WHERE COALESCE(returned_to_shell, 0) = 1`,
      )
      .pluck()
      .get() || 0,
  );

  const topCommands = db
    .prepare(
      `SELECT command_text AS command, COUNT(*) AS count
       FROM commands
       GROUP BY command_text
       ORDER BY count DESC, MAX(finished_at_ms) DESC
       LIMIT 8`,
    )
    .all() as Array<{ command: string; count: number }>;

  const latencyByModel = db
    .prepare(
      `SELECT
         CASE
           WHEN TRIM(request_model_name) <> '' THEN request_model_name
           ELSE model_name
         END AS model,
         COUNT(*) AS count,
         ROUND(
           AVG(
             CASE
               WHEN request_latency_ms > 0 THEN request_latency_ms
               WHEN latency_ms > 0 THEN latency_ms
             END
           ),
           1
         ) AS avgLatencyMs
       FROM suggestions
       WHERE COALESCE(returned_to_shell, 0) = 1
         AND TRIM(CASE WHEN TRIM(request_model_name) <> '' THEN request_model_name ELSE model_name END) <> ''
       GROUP BY model
       ORDER BY count DESC, model ASC`,
    )
    .all() as Array<{ model: string; count: number; avgLatencyMs: number }>;

  const totalFeedback = totals.accepted + totals.edited + totals.rejected;
  return {
    runtime: getRuntimeStatus(),
    totals,
    acceptanceRate: totalFeedback > 0 ? totals.accepted / totalFeedback : 0,
    averageModelLatency,
    topCommands,
    topRejectedSuggestions: feedbackSummary.topRejectedSuggestions,
    recentSuggestions: listSuggestions({
      page: 1,
      pageSize: 8,
      outcome: "all",
      returnedToShellOnly: true,
    }).rows,
    latencyByModel,
    acceptanceByPath: feedbackSummary.acceptanceByPath,
  };
}
