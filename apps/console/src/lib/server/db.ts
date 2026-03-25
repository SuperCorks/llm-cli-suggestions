import "server-only";

import Database from "better-sqlite3";

import { ensureStateDirs, getResolvedRuntimeSettings } from "@/lib/server/config";

const SQLITE_BUSY_TIMEOUT_MS = 15_000;

let database: Database.Database | null = null;
let databasePath = "";

function hasTable(db: Database.Database, tableName: string) {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .pluck()
      .get(tableName),
  );
}

function getColumnNames(db: Database.Database, tableName: string) {
  if (!hasTable(db, tableName)) {
    return new Set<string>();
  }
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((row) =>
      String(row.name),
    ),
  );
}

function ensureSuggestionColumns(db: Database.Database) {
  if (!hasTable(db, "suggestions")) {
    return;
  }

  const columns = getColumnNames(db, "suggestions");

  if (!columns.has("prompt_text")) {
    db.exec("ALTER TABLE suggestions ADD COLUMN prompt_text TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.has("structured_context_json")) {
    db.exec(
      "ALTER TABLE suggestions ADD COLUMN structured_context_json TEXT NOT NULL DEFAULT ''",
    );
  }
  if (!columns.has("request_latency_ms")) {
    db.exec("ALTER TABLE suggestions ADD COLUMN request_latency_ms INTEGER NOT NULL DEFAULT -1");
  }
  if (!columns.has("request_model_name")) {
    db.exec("ALTER TABLE suggestions ADD COLUMN request_model_name TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.has("model_total_duration_ms")) {
    db.exec("ALTER TABLE suggestions ADD COLUMN model_total_duration_ms INTEGER NOT NULL DEFAULT -1");
  }
  if (!columns.has("model_load_duration_ms")) {
    db.exec("ALTER TABLE suggestions ADD COLUMN model_load_duration_ms INTEGER NOT NULL DEFAULT -1");
  }
  if (!columns.has("model_prompt_eval_duration_ms")) {
    db.exec(
      "ALTER TABLE suggestions ADD COLUMN model_prompt_eval_duration_ms INTEGER NOT NULL DEFAULT -1",
    );
  }
  if (!columns.has("model_eval_duration_ms")) {
    db.exec("ALTER TABLE suggestions ADD COLUMN model_eval_duration_ms INTEGER NOT NULL DEFAULT -1");
  }
  if (!columns.has("model_prompt_eval_count")) {
    db.exec("ALTER TABLE suggestions ADD COLUMN model_prompt_eval_count INTEGER NOT NULL DEFAULT -1");
  }
  if (!columns.has("model_eval_count")) {
    db.exec("ALTER TABLE suggestions ADD COLUMN model_eval_count INTEGER NOT NULL DEFAULT -1");
  }
}

function ensureConsoleTables(db: Database.Database) {
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

    CREATE INDEX IF NOT EXISTS idx_benchmark_results_run_id
      ON benchmark_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_benchmark_results_model
      ON benchmark_results(model_name, run_id);
    CREATE INDEX IF NOT EXISTS idx_benchmark_results_category
      ON benchmark_results(category, run_id);

    CREATE TABLE IF NOT EXISTS suggestion_reviews (
      suggestion_id INTEGER PRIMARY KEY,
      review_label TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_suggestion_reviews_label
      ON suggestion_reviews(review_label, updated_at_ms DESC);
  `);

  ensureSuggestionColumns(db);
}

export function getDb() {
  const settings = getResolvedRuntimeSettings();
  if (database && databasePath === settings.dbPath) {
    return database;
  }

  ensureStateDirs();
  if (database) {
    database.close();
  }
  database = new Database(settings.dbPath);
  databasePath = settings.dbPath;
  database.pragma("journal_mode = WAL");
  database.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  ensureConsoleTables(database);
  return database;
}
