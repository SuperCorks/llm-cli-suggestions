package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type CommandFeedbackStats struct {
	AcceptedCount int
	RejectedCount int
}

type CommandContext struct {
	Command       string
	StdoutExcerpt string
	StderrExcerpt string
}

type Summary struct {
	SessionCount        int
	CommandCount        int
	SuggestionCount     int
	AcceptedCount       int
	RejectedCount       int
	AverageModelLatency float64
}

type TopCommand struct {
	Command string
	Count   int
}

type RecentFeedback struct {
	EventType       string
	Suggestion      string
	AcceptedCommand string
	ActualCommand   string
	CreatedAtMS     int64
}

func (s *Store) GetCommandFeedbackStats(ctx context.Context, commands []string) (map[string]CommandFeedbackStats, error) {
	stats := make(map[string]CommandFeedbackStats, len(commands))
	filtered := uniqueNonEmpty(commands)
	if len(filtered) == 0 {
		return stats, nil
	}

	acceptedQuery := fmt.Sprintf(
		`SELECT accepted_command, COUNT(*)
		 FROM feedback_events
		 WHERE event_type = 'accepted' AND accepted_command IN (%s)
		 GROUP BY accepted_command`,
		placeholders(len(filtered)),
	)
	rows, err := s.db.QueryContext(ctx, acceptedQuery, stringArgs(filtered)...)
	if err != nil {
		return nil, fmt.Errorf("query accepted feedback stats: %w", err)
	}
	for rows.Next() {
		var command string
		var count int
		if err := rows.Scan(&command, &count); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan accepted feedback stats: %w", err)
		}
		entry := stats[command]
		entry.AcceptedCount = count
		stats[command] = entry
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	rejectedQuery := fmt.Sprintf(
		`SELECT suggestion_text, COUNT(*)
		 FROM feedback_events
		 WHERE event_type = 'rejected' AND suggestion_text IN (%s)
		 GROUP BY suggestion_text`,
		placeholders(len(filtered)),
	)
	rows, err = s.db.QueryContext(ctx, rejectedQuery, stringArgs(filtered)...)
	if err != nil {
		return nil, fmt.Errorf("query rejected feedback stats: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var command string
		var count int
		if err := rows.Scan(&command, &count); err != nil {
			return nil, fmt.Errorf("scan rejected feedback stats: %w", err)
		}
		entry := stats[command]
		entry.RejectedCount = count
		stats[command] = entry
	}
	return stats, rows.Err()
}

func (s *Store) GetLastCommandContext(ctx context.Context, sessionID string) (CommandContext, error) {
	if sessionID == "" {
		return CommandContext{}, nil
	}

	var result CommandContext
	err := s.db.QueryRowContext(
		ctx,
		`SELECT command_text, stdout_excerpt, stderr_excerpt
		 FROM commands
		 WHERE session_id = ?
		 ORDER BY finished_at_ms DESC
		 LIMIT 1`,
		sessionID,
	).Scan(&result.Command, &result.StdoutExcerpt, &result.StderrExcerpt)
	if err != nil {
		if err == sql.ErrNoRows {
			return CommandContext{}, nil
		}
		return CommandContext{}, fmt.Errorf("query last command context: %w", err)
	}

	return result, nil
}

func (s *Store) InspectSummary(ctx context.Context) (Summary, error) {
	summary := Summary{}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions`).Scan(&summary.SessionCount); err != nil {
		return Summary{}, fmt.Errorf("count sessions: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM commands`).Scan(&summary.CommandCount); err != nil {
		return Summary{}, fmt.Errorf("count commands: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM suggestions`).Scan(&summary.SuggestionCount); err != nil {
		return Summary{}, fmt.Errorf("count suggestions: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM feedback_events WHERE event_type = 'accepted'`).Scan(&summary.AcceptedCount); err != nil {
		return Summary{}, fmt.Errorf("count accepted events: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM feedback_events WHERE event_type = 'rejected'`).Scan(&summary.RejectedCount); err != nil {
		return Summary{}, fmt.Errorf("count rejected events: %w", err)
	}
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT COALESCE(AVG(CASE WHEN latency_ms > 0 THEN latency_ms END), 0) FROM suggestions`,
	).Scan(&summary.AverageModelLatency); err != nil {
		return Summary{}, fmt.Errorf("avg latency: %w", err)
	}

	return summary, nil
}

func (s *Store) GetTopCommands(ctx context.Context, limit int) ([]TopCommand, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT command_text, COUNT(*) AS command_count
		 FROM commands
		 GROUP BY command_text
		 ORDER BY command_count DESC, MAX(finished_at_ms) DESC
		 LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query top commands: %w", err)
	}
	defer rows.Close()

	var result []TopCommand
	for rows.Next() {
		var row TopCommand
		if err := rows.Scan(&row.Command, &row.Count); err != nil {
			return nil, fmt.Errorf("scan top commands: %w", err)
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (s *Store) GetRecentFeedback(ctx context.Context, limit int) ([]RecentFeedback, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT event_type, suggestion_text, accepted_command, actual_command, created_at_ms
		 FROM feedback_events
		 ORDER BY created_at_ms DESC
		 LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query recent feedback: %w", err)
	}
	defer rows.Close()

	var result []RecentFeedback
	for rows.Next() {
		var row RecentFeedback
		if err := rows.Scan(&row.EventType, &row.Suggestion, &row.AcceptedCommand, &row.ActualCommand, &row.CreatedAtMS); err != nil {
			return nil, fmt.Errorf("scan recent feedback: %w", err)
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	parts := make([]string, count)
	for index := 0; index < count; index++ {
		parts[index] = "?"
	}
	return strings.Join(parts, ",")
}

func stringArgs(values []string) []any {
	args := make([]any, 0, len(values))
	for _, value := range values {
		args = append(args, value)
	}
	return args
}

func uniqueNonEmpty(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
