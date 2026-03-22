import "server-only";

import Database from "better-sqlite3";

import { ensureStateDirs, getResolvedRuntimeSettings } from "@/lib/server/config";

let database: Database.Database | null = null;

function hasTable(db: Database.Database, tableName: string) {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .pluck()
      .get(tableName),
  );
}

function ensureSuggestionColumns(db: Database.Database) {
  if (!hasTable(db, "suggestions")) {
    return;
  }

  const columns = new Set(
    (db.prepare("PRAGMA table_info(suggestions)").all() as Array<{ name: string }>).map((row) =>
      String(row.name),
    ),
  );

  if (!columns.has("prompt_text")) {
    db.exec("ALTER TABLE suggestions ADD COLUMN prompt_text TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.has("structured_context_json")) {
    db.exec(
      "ALTER TABLE suggestions ADD COLUMN structured_context_json TEXT NOT NULL DEFAULT ''",
    );
  }
}

function ensureConsoleTables(db: Database.Database) {
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

    CREATE INDEX IF NOT EXISTS idx_benchmark_results_run_id
      ON benchmark_results(run_id);

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
  if (database) {
    return database;
  }

  ensureStateDirs();
  const settings = getResolvedRuntimeSettings();
  database = new Database(settings.dbPath);
  database.pragma("journal_mode = WAL");
  ensureConsoleTables(database);
  return database;
}
