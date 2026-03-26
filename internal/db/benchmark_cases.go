package db

import (
	"context"
	"fmt"
)

type ReplayBenchmarkCandidate struct {
	SuggestionID          int64
	Buffer                string
	SuggestionText        string
	AcceptedCommand       string
	ActualCommand         string
	CWD                   string
	RepoRoot              string
	Branch                string
	LastExitCode          int
	PromptText            string
	StructuredContextJSON string
	QualityLabel          string
	FeedbackEvent         string
	Source                string
	ModelName             string
	CreatedAtMS           int64
}

func (s *Store) ListReplayBenchmarkCandidates(ctx context.Context, limit int) ([]ReplayBenchmarkCandidate, error) {
	if limit <= 0 {
		limit = 500
	}

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT
		   s.id,
		   s.buffer,
		   s.suggestion_text,
		   COALESCE(f.accepted_command, '') AS accepted_command,
		   COALESCE(f.actual_command, '') AS actual_command,
		   s.cwd,
		   s.repo_root,
		   s.branch,
		   s.last_exit_code,
		   COALESCE(s.prompt_text, '') AS prompt_text,
		   COALESCE(s.structured_context_json, '') AS structured_context_json,
		   COALESCE(r.review_label, '') AS quality_label,
		   COALESCE(f.event_type, '') AS feedback_event,
		   s.source,
		   CASE
		     WHEN TRIM(s.request_model_name) <> '' THEN s.request_model_name
		     ELSE s.model_name
		   END AS model_name,
		   s.created_at_ms
		 FROM suggestions s
		 LEFT JOIN suggestion_reviews r ON r.suggestion_id = s.id
		 LEFT JOIN (
		   SELECT
		     suggestion_id,
		     COALESCE(
		       MAX(CASE WHEN event_type = 'executed_edited' THEN 'executed_edited' END),
		       MAX(CASE WHEN event_type IN ('executed_unchanged', 'accepted') THEN 'executed_unchanged' END),
		       MAX(CASE WHEN event_type = 'rejected' THEN 'rejected' END),
		       MAX(CASE WHEN event_type = 'accepted_buffer' THEN 'accepted_buffer' END),
		       ''
		     ) AS event_type,
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
		 WHERE COALESCE(r.review_label, '') IN ('good', 'bad')
		    OR COALESCE(f.event_type, '') IN ('executed_unchanged', 'executed_edited', 'rejected')
		 ORDER BY s.created_at_ms DESC
		 LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query replay benchmark candidates: %w", err)
	}
	defer rows.Close()

	var results []ReplayBenchmarkCandidate
	for rows.Next() {
		var row ReplayBenchmarkCandidate
		if err := rows.Scan(
			&row.SuggestionID,
			&row.Buffer,
			&row.SuggestionText,
			&row.AcceptedCommand,
			&row.ActualCommand,
			&row.CWD,
			&row.RepoRoot,
			&row.Branch,
			&row.LastExitCode,
			&row.PromptText,
			&row.StructuredContextJSON,
			&row.QualityLabel,
			&row.FeedbackEvent,
			&row.Source,
			&row.ModelName,
			&row.CreatedAtMS,
		); err != nil {
			return nil, fmt.Errorf("scan replay benchmark candidate: %w", err)
		}
		results = append(results, row)
	}
	return results, rows.Err()
}
