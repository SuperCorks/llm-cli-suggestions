package db

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

const sqliteBusyTimeoutMS = 15_000

type CommandCandidate struct {
	Command      string
	Score        int
	Hits         int
	LastUsedAtMS int64
}

type SuggestionRecord struct {
	RequestID              string
	AttemptIndex           int
	ReturnedToShell        bool
	ValidationState        string
	ValidationFailuresJSON string
	SessionID              string
	Buffer                 string
	Suggestion             string
	Source                 string
	CWD                    string
	RepoRoot               string
	Branch                 string
	LastExitCode           int
	LatencyMS              int64
	RequestLatencyMS       int64
	ModelName              string
	RequestModelName       string
	ModelKeepAlive         string
	ModelStartState        string
	ModelTotalDurationMS   int64
	ModelLoadDurationMS    int64
	ModelPromptEvalMS      int64
	ModelEvalDurationMS    int64
	ModelPromptEvalCount   int64
	ModelEvalCount         int64
	ModelError             string
	PromptText             string
	StructuredContextJSON  string
	CreatedAtMS            int64
}

type FeedbackRecord struct {
	SuggestionID    int64
	SessionID       string
	EventType       string
	Buffer          string
	Suggestion      string
	AcceptedCommand string
	ActualCommand   string
	CreatedAtMS     int64
}

type CommandRecord struct {
	SessionID     string
	Command       string
	CWD           string
	RepoRoot      string
	Branch        string
	ExitCode      int
	DurationMS    int64
	StartedAtMS   int64
	FinishedAtMS  int64
	StdoutExcerpt string
	StderrExcerpt string
}

func NewStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite db: %w", err)
	}
	db.SetMaxOpenConns(1)

	store := &Store{db: db}
	if err := store.configureSQLite(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := store.migrate(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}

	return store, nil
}

func (s *Store) configureSQLite(ctx context.Context) error {
	pragmas := []string{
		"PRAGMA journal_mode = WAL",
		fmt.Sprintf("PRAGMA busy_timeout = %d", sqliteBusyTimeoutMS),
	}
	for _, pragma := range pragmas {
		if _, err := s.db.ExecContext(ctx, pragma); err != nil {
			return fmt.Errorf("configure sqlite pragma %q: %w", pragma, err)
		}
	}
	return nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			created_at_ms INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS commands (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			command_text TEXT NOT NULL,
			cwd TEXT NOT NULL,
			repo_root TEXT NOT NULL,
			branch TEXT NOT NULL,
			exit_code INTEGER NOT NULL,
			duration_ms INTEGER NOT NULL,
			started_at_ms INTEGER NOT NULL,
			finished_at_ms INTEGER NOT NULL,
			stdout_excerpt TEXT NOT NULL DEFAULT '',
			stderr_excerpt TEXT NOT NULL DEFAULT ''
		);`,
		`CREATE INDEX IF NOT EXISTS idx_commands_prefix ON commands(command_text);`,
		`CREATE INDEX IF NOT EXISTS idx_commands_session_finished ON commands(session_id, finished_at_ms DESC);`,
		`CREATE TABLE IF NOT EXISTS suggestions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			request_id TEXT NOT NULL DEFAULT '',
			attempt_index INTEGER NOT NULL DEFAULT 0,
			returned_to_shell INTEGER NOT NULL DEFAULT 0,
			validation_state TEXT NOT NULL DEFAULT 'skipped',
			validation_failures_json TEXT NOT NULL DEFAULT '',
			session_id TEXT NOT NULL,
			buffer TEXT NOT NULL,
			suggestion_text TEXT NOT NULL,
			source TEXT NOT NULL,
			cwd TEXT NOT NULL,
			repo_root TEXT NOT NULL,
			branch TEXT NOT NULL,
			last_exit_code INTEGER NOT NULL,
			latency_ms INTEGER NOT NULL,
			request_latency_ms INTEGER NOT NULL DEFAULT -1,
			model_name TEXT NOT NULL,
			request_model_name TEXT NOT NULL DEFAULT '',
			model_keep_alive TEXT NOT NULL DEFAULT '',
			model_start_state TEXT NOT NULL DEFAULT '',
			model_total_duration_ms INTEGER NOT NULL DEFAULT -1,
			model_load_duration_ms INTEGER NOT NULL DEFAULT -1,
			model_prompt_eval_duration_ms INTEGER NOT NULL DEFAULT -1,
			model_eval_duration_ms INTEGER NOT NULL DEFAULT -1,
			model_prompt_eval_count INTEGER NOT NULL DEFAULT -1,
			model_eval_count INTEGER NOT NULL DEFAULT -1,
			model_error TEXT NOT NULL DEFAULT '',
			prompt_text TEXT NOT NULL DEFAULT '',
			structured_context_json TEXT NOT NULL DEFAULT '',
			created_at_ms INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS feedback_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			suggestion_id INTEGER NOT NULL,
			session_id TEXT NOT NULL,
			event_type TEXT NOT NULL,
			buffer TEXT NOT NULL,
			suggestion_text TEXT NOT NULL,
			accepted_command TEXT NOT NULL,
			actual_command TEXT NOT NULL,
			created_at_ms INTEGER NOT NULL
		);`,
	}

	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("run migration: %w", err)
		}
	}

	if err := s.ensureColumn(ctx, "suggestions", "prompt_text", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "structured_context_json", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "request_latency_ms", "INTEGER NOT NULL DEFAULT -1"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "request_model_name", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "model_keep_alive", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "model_start_state", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "model_total_duration_ms", "INTEGER NOT NULL DEFAULT -1"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "model_load_duration_ms", "INTEGER NOT NULL DEFAULT -1"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "model_prompt_eval_duration_ms", "INTEGER NOT NULL DEFAULT -1"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "model_eval_duration_ms", "INTEGER NOT NULL DEFAULT -1"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "model_prompt_eval_count", "INTEGER NOT NULL DEFAULT -1"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "model_eval_count", "INTEGER NOT NULL DEFAULT -1"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "model_error", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "request_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "attempt_index", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "returned_to_shell", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "validation_state", "TEXT NOT NULL DEFAULT 'skipped'"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "suggestions", "validation_failures_json", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureBenchmarkTables(ctx); err != nil {
		return err
	}

	return nil
}

func (s *Store) ensureBenchmarkTables(ctx context.Context) error {
	resetRuns, err := s.shouldResetBenchmarkTable(ctx, "benchmark_runs", "track")
	if err != nil {
		return err
	}
	hasLogText := true
	hasLastEvent := true
	if exists, err := s.tableExists(ctx, "benchmark_runs"); err != nil {
		return err
	} else if exists {
		if hasLogText, err = s.hasColumn(ctx, "benchmark_runs", "log_text"); err != nil {
			return err
		}
		if hasLastEvent, err = s.hasColumn(ctx, "benchmark_runs", "last_event_at_ms"); err != nil {
			return err
		}
	}
	resetResults, err := s.shouldResetBenchmarkTable(ctx, "benchmark_results", "case_id")
	if err != nil {
		return err
	}
	if resetRuns || resetResults || !hasLogText || !hasLastEvent {
		if _, err := s.db.ExecContext(ctx, `DROP TABLE IF EXISTS benchmark_results; DROP TABLE IF EXISTS benchmark_runs;`); err != nil {
			return fmt.Errorf("reset benchmark tables: %w", err)
		}
	}

	statements := []string{
		`CREATE TABLE IF NOT EXISTS benchmark_runs (
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
		);`,
		`CREATE TABLE IF NOT EXISTS benchmark_results (
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
		);`,
		`CREATE INDEX IF NOT EXISTS idx_benchmark_results_run_id ON benchmark_results(run_id);`,
		`CREATE INDEX IF NOT EXISTS idx_benchmark_results_model ON benchmark_results(model_name, run_id);`,
		`CREATE INDEX IF NOT EXISTS idx_benchmark_results_category ON benchmark_results(category, run_id);`,
		`CREATE TABLE IF NOT EXISTS suggestion_reviews (
			suggestion_id INTEGER PRIMARY KEY,
			review_label TEXT NOT NULL,
			updated_at_ms INTEGER NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_suggestion_reviews_label
			ON suggestion_reviews(review_label, updated_at_ms DESC);`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("create benchmark table: %w", err)
		}
	}
	return nil
}

func (s *Store) shouldResetBenchmarkTable(ctx context.Context, table, requiredColumn string) (bool, error) {
	exists, err := s.tableExists(ctx, table)
	if err != nil {
		return false, err
	}
	if !exists {
		return false, nil
	}
	hasColumn, err := s.hasColumn(ctx, table, requiredColumn)
	if err != nil {
		return false, err
	}
	return !hasColumn, nil
}

func (s *Store) tableExists(ctx context.Context, table string) (bool, error) {
	var name string
	err := s.db.QueryRowContext(
		ctx,
		`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
		table,
	).Scan(&name)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("inspect table %s: %w", table, err)
	}
	return true, nil
}

func (s *Store) hasColumn(ctx context.Context, table, column string) (bool, error) {
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return false, fmt.Errorf("inspect %s columns: %w", table, err)
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var colType string
		var notNull int
		var defaultValue sql.NullString
		var primaryKey int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &defaultValue, &primaryKey); err != nil {
			return false, fmt.Errorf("scan %s column: %w", table, err)
		}
		if name == column {
			return true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("read %s columns: %w", table, err)
	}
	return false, nil
}

func (s *Store) ensureColumn(ctx context.Context, table, column, definition string) error {
	hasColumn, err := s.hasColumn(ctx, table, column)
	if err != nil {
		return err
	}
	if hasColumn {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, definition)); err != nil {
		return fmt.Errorf("add %s.%s: %w", table, column, err)
	}
	return nil
}

func (s *Store) EnsureSession(ctx context.Context, sessionID string) error {
	if sessionID == "" {
		return nil
	}
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO sessions(id, created_at_ms) VALUES(?, ?)
		 ON CONFLICT(id) DO NOTHING`,
		sessionID,
		nowMS(),
	)
	if err != nil {
		return fmt.Errorf("ensure session: %w", err)
	}
	return nil
}

func (s *Store) GetRecentCommands(ctx context.Context, sessionID string, limit int) ([]string, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT command_text
		 FROM commands
		 WHERE session_id = ?
		 ORDER BY finished_at_ms DESC
		 LIMIT ?`,
		sessionID,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query recent commands: %w", err)
	}
	defer rows.Close()

	var commands []string
	for rows.Next() {
		var command string
		if err := rows.Scan(&command); err != nil {
			return nil, fmt.Errorf("scan recent command: %w", err)
		}
		commands = append(commands, command)
	}
	return commands, rows.Err()
}

func (s *Store) GetRecentCommandsByCWD(ctx context.Context, cwd string, limit int) ([]string, error) {
	if strings.TrimSpace(cwd) == "" {
		return []string{}, nil
	}

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT command_text
		 FROM commands
		 WHERE cwd = ?
		 ORDER BY finished_at_ms DESC
		 LIMIT ?`,
		cwd,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query recent commands by cwd: %w", err)
	}
	defer rows.Close()

	var commands []string
	for rows.Next() {
		var command string
		if err := rows.Scan(&command); err != nil {
			return nil, fmt.Errorf("scan recent command by cwd: %w", err)
		}
		commands = append(commands, command)
	}
	return commands, rows.Err()
}

func (s *Store) FindCommandCandidates(ctx context.Context, prefix, cwd, repoRoot, branch string, limit int) ([]CommandCandidate, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT command_text, cwd, repo_root, branch, finished_at_ms
		 FROM commands
		 WHERE command_text LIKE ? || '%'
		 ORDER BY finished_at_ms DESC
		 LIMIT 200`,
		prefix,
	)
	if err != nil {
		return nil, fmt.Errorf("query command candidates: %w", err)
	}
	defer rows.Close()

	type aggregate struct {
		Command      string
		Score        int
		Hits         int
		LastUsedAtMS int64
	}

	candidates := map[string]*aggregate{}
	for rows.Next() {
		var commandText string
		var commandCWD string
		var commandRepoRoot string
		var commandBranch string
		var finishedAtMS int64

		if err := rows.Scan(&commandText, &commandCWD, &commandRepoRoot, &commandBranch, &finishedAtMS); err != nil {
			return nil, fmt.Errorf("scan command candidate: %w", err)
		}

		entry := candidates[commandText]
		if entry == nil {
			entry = &aggregate{Command: commandText, LastUsedAtMS: finishedAtMS}
			candidates[commandText] = entry
		}

		entry.Hits++
		entry.Score += 10
		if commandCWD == cwd {
			entry.Score += 8
		}
		if repoRoot != "" && commandRepoRoot == repoRoot {
			entry.Score += 12
		}
		if branch != "" && commandBranch == branch {
			entry.Score += 4
		}
		if finishedAtMS > entry.LastUsedAtMS {
			entry.LastUsedAtMS = finishedAtMS
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]CommandCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		result = append(result, CommandCandidate{
			Command:      candidate.Command,
			Score:        candidate.Score,
			Hits:         candidate.Hits,
			LastUsedAtMS: candidate.LastUsedAtMS,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].Score != result[j].Score {
			return result[i].Score > result[j].Score
		}
		if result[i].Hits != result[j].Hits {
			return result[i].Hits > result[j].Hits
		}
		return result[i].LastUsedAtMS > result[j].LastUsedAtMS
	})

	if len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

func (s *Store) CreateSuggestion(ctx context.Context, record SuggestionRecord) (int64, error) {
	result, err := s.db.ExecContext(
		ctx,
		`INSERT INTO suggestions(
			request_id, attempt_index, returned_to_shell, validation_state, validation_failures_json,
			session_id, buffer, suggestion_text, source, cwd, repo_root, branch,
			last_exit_code, latency_ms, request_latency_ms, model_name, request_model_name,
			model_keep_alive, model_start_state,
			model_total_duration_ms, model_load_duration_ms, model_prompt_eval_duration_ms,
			model_eval_duration_ms, model_prompt_eval_count, model_eval_count, model_error,
			prompt_text, structured_context_json, created_at_ms
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		record.RequestID,
		record.AttemptIndex,
		boolToInt(record.ReturnedToShell),
		record.ValidationState,
		record.ValidationFailuresJSON,
		record.SessionID,
		record.Buffer,
		record.Suggestion,
		record.Source,
		record.CWD,
		record.RepoRoot,
		record.Branch,
		record.LastExitCode,
		record.LatencyMS,
		record.RequestLatencyMS,
		record.ModelName,
		record.RequestModelName,
		record.ModelKeepAlive,
		record.ModelStartState,
		record.ModelTotalDurationMS,
		record.ModelLoadDurationMS,
		record.ModelPromptEvalMS,
		record.ModelEvalDurationMS,
		record.ModelPromptEvalCount,
		record.ModelEvalCount,
		record.ModelError,
		record.PromptText,
		record.StructuredContextJSON,
		record.CreatedAtMS,
	)
	if err != nil {
		return 0, fmt.Errorf("create suggestion: %w", err)
	}
	suggestionID, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("resolve suggestion id: %w", err)
	}
	return suggestionID, nil
}

func (s *Store) RecordFeedback(ctx context.Context, record FeedbackRecord) error {
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO feedback_events(
			suggestion_id, session_id, event_type, buffer, suggestion_text,
			accepted_command, actual_command, created_at_ms
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
		record.SuggestionID,
		record.SessionID,
		record.EventType,
		record.Buffer,
		record.Suggestion,
		record.AcceptedCommand,
		record.ActualCommand,
		record.CreatedAtMS,
	)
	if err != nil {
		return fmt.Errorf("record feedback: %w", err)
	}
	return nil
}

func (s *Store) RecordCommand(ctx context.Context, record CommandRecord) error {
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO commands(
			session_id, command_text, cwd, repo_root, branch, exit_code, duration_ms,
			started_at_ms, finished_at_ms, stdout_excerpt, stderr_excerpt
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		record.SessionID,
		record.Command,
		record.CWD,
		record.RepoRoot,
		record.Branch,
		record.ExitCode,
		record.DurationMS,
		record.StartedAtMS,
		record.FinishedAtMS,
		record.StdoutExcerpt,
		record.StderrExcerpt,
	)
	if err != nil {
		return fmt.Errorf("record command: %w", err)
	}
	return nil
}

func nowMS() int64 {
	return time.Now().UnixMilli()
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
