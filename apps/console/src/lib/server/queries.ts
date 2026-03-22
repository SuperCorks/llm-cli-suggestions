import "server-only";

import { formatTimestamp } from "@/lib/format";
import { getDb } from "@/lib/server/db";
import { getRuntimeStatus } from "@/lib/server/runtime";
import type {
  ActivitySignal,
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
  return {
    id: row.id,
    timestamp: formatTimestamp(row.createdAtMs),
    tone: row.accepted ? "accepted" : row.rejected ? "rejected" : "observed",
    label: row.accepted ? "ACCEPT" : row.rejected ? "REJECT" : "TRACE",
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
    clauses.push("s.model_name = ?");
    params.push(input.model);
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
    clauses.push("(s.buffer LIKE ? OR s.suggestion_text LIKE ?)");
    params.push(normalizeLike(input.query), normalizeLike(input.query));
  }
  if (input.outcome === "accepted") {
    clauses.push("COALESCE(f.accepted, 0) = 1");
  } else if (input.outcome === "rejected") {
    clauses.push("COALESCE(f.rejected, 0) = 1");
  } else if (input.outcome === "unreviewed") {
    clauses.push("COALESCE(f.accepted, 0) = 0 AND COALESCE(f.rejected, 0) = 0");
  }
  if (input.quality === "good" || input.quality === "bad") {
    clauses.push("COALESCE(r.review_label, '') = ?");
    params.push(input.quality);
  } else if (input.quality === "unlabeled") {
    clauses.push("COALESCE(r.review_label, '') = ''");
  }

  const where = buildWhere(clauses);
  const orderBy = getSuggestionOrderBy(input.sort);
  const fromClause = `
    FROM suggestions s
    LEFT JOIN (
      SELECT
        suggestion_id,
        MAX(CASE WHEN event_type = 'accepted' THEN 1 ELSE 0 END) AS accepted,
        MAX(CASE WHEN event_type = 'rejected' THEN 1 ELSE 0 END) AS rejected,
        MAX(accepted_command) AS accepted_command,
        MAX(actual_command) AS actual_command
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
         s.latency_ms AS latencyMs,
         s.created_at_ms AS createdAtMs,
         COALESCE(f.accepted, 0) AS accepted,
         COALESCE(f.rejected, 0) AS rejected,
         COALESCE(f.accepted_command, '') AS acceptedCommand,
         COALESCE(f.actual_command, '') AS actualCommand,
         COALESCE(s.prompt_text, '') AS promptText,
         COALESCE(s.structured_context_json, '') AS structuredContextJson,
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

function getSuggestionOrderBy(sort?: SuggestionSort) {
  switch (sort) {
    case "oldest":
      return "s.created_at_ms ASC, s.id ASC";
    case "latency-desc":
      return "s.latency_ms DESC, s.created_at_ms DESC";
    case "latency-asc":
      return "s.latency_ms ASC, s.created_at_ms DESC";
    case "buffer-asc":
      return "s.buffer ASC, s.created_at_ms DESC";
    case "model-asc":
      return "CASE WHEN s.model_name = '' THEN 1 ELSE 0 END, s.model_name ASC, s.created_at_ms DESC";
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
          SUM(CASE WHEN fe.event_type = 'accepted' THEN 1 ELSE 0 END) AS accepted,
          SUM(CASE WHEN fe.event_type = 'rejected' THEN 1 ELSE 0 END) AS rejected
       ${fromClause}
       GROUP BY path
       HAVING accepted + rejected > 0
       ORDER BY accepted DESC, rejected DESC, path ASC
       LIMIT 12`,
    )
    .all(...params)
    .map((row) => {
      const parsed = row as Record<string, unknown>;
      const accepted = Number(parsed.accepted || 0);
      const rejected = Number(parsed.rejected || 0);
      return {
        path: String(parsed.path || ""),
        accepted,
        rejected,
        acceptanceRate: accepted / Math.max(1, accepted + rejected),
      };
    });

  return { recentFeedback, topRejectedSuggestions, acceptanceByPath };
}

export function listBenchmarkRuns(limit = 20): BenchmarkRunRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT
         id,
         status,
         models,
         repeat_count AS repeatCount,
         timeout_ms AS timeoutMs,
         output_json_path AS outputJsonPath,
         summary_json AS summaryJson,
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
        models: String(parsed.models || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        repeatCount: Number(parsed.repeatCount || 0),
        timeoutMs: Number(parsed.timeoutMs || 0),
        outputJsonPath: String(parsed.outputJsonPath || ""),
        summary: parsed.summaryJson ? JSON.parse(String(parsed.summaryJson)) : null,
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
         case_name AS caseName,
         run_number AS runNumber,
         latency_ms AS latencyMs,
         suggestion_text AS suggestionText,
         valid_prefix AS validPrefix,
         accepted,
         error_text AS errorText,
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
        caseName: String(parsed.caseName || ""),
        runNumber: Number(parsed.runNumber || 0),
        latencyMs: Number(parsed.latencyMs || 0),
        suggestionText: String(parsed.suggestionText || ""),
        validPrefix: Number(parsed.validPrefix || 0) === 1,
        accepted: Number(parsed.accepted || 0) === 1,
        errorText: String(parsed.errorText || ""),
        createdAtMs: Number(parsed.createdAtMs || 0),
      } satisfies BenchmarkResultRow;
    });

  return { run, results };
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
         r.models,
         r.repeat_count,
         r.timeout_ms,
         r.created_at_ms,
         r.started_at_ms,
         r.finished_at_ms,
         r.error_text,
         br.model_name,
         br.case_name,
         br.run_number,
         br.latency_ms,
         br.suggestion_text,
         br.valid_prefix,
         br.accepted,
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
    suggestions: Number(db.prepare("SELECT COUNT(*) FROM suggestions").pluck().get() || 0),
    accepted: Number(
      db
        .prepare("SELECT COUNT(*) FROM feedback_events WHERE event_type = 'accepted'")
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
        "SELECT COALESCE(AVG(CASE WHEN latency_ms > 0 THEN latency_ms END), 0) FROM suggestions",
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
         model_name AS model,
         COUNT(*) AS count,
         ROUND(AVG(CASE WHEN latency_ms > 0 THEN latency_ms END), 1) AS avgLatencyMs
       FROM suggestions
       WHERE model_name != ''
       GROUP BY model_name
       ORDER BY count DESC, model_name ASC`,
    )
    .all() as Array<{ model: string; count: number; avgLatencyMs: number }>;

  const totalFeedback = totals.accepted + totals.rejected;
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
    }).rows,
    latencyByModel,
    acceptanceByPath: feedbackSummary.acceptanceByPath,
  };
}
