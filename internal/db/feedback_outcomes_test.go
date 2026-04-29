package db

import (
	"context"
	"path/filepath"
	"testing"
)

func TestGetCommandFeedbackStatsUsesTerminalAcceptedEvents(t *testing.T) {
	t.Parallel()

	store := newOutcomeTestStore(t)
	ctx := context.Background()
	if err := store.EnsureSession(ctx, "session-1"); err != nil {
		t.Fatalf("EnsureSession: %v", err)
	}

	recordFeedback(t, store, FeedbackRecord{
		SuggestionID:    1,
		SessionID:       "session-1",
		EventType:       "accepted_buffer",
		Suggestion:      "git status",
		AcceptedCommand: "git status",
	})
	recordFeedback(t, store, FeedbackRecord{
		SuggestionID:    1,
		SessionID:       "session-1",
		EventType:       "executed_unchanged",
		Suggestion:      "git status",
		AcceptedCommand: "git status",
		ActualCommand:   "git status",
	})
	recordFeedback(t, store, FeedbackRecord{
		SuggestionID:    2,
		SessionID:       "session-1",
		EventType:       "executed_edited",
		Suggestion:      "git status",
		AcceptedCommand: "git status",
		ActualCommand:   "git status --short",
	})
	recordFeedback(t, store, FeedbackRecord{
		SuggestionID:  3,
		SessionID:     "session-1",
		EventType:     "rejected",
		Suggestion:    "git stash",
		ActualCommand: "git status",
	})

	stats, err := store.GetCommandFeedbackStats(ctx, []string{"git status", "git stash"})
	if err != nil {
		t.Fatalf("GetCommandFeedbackStats: %v", err)
	}

	if stats["git status"].AcceptedCount != 1 {
		t.Fatalf("expected only executed_unchanged to count as accepted, got %d", stats["git status"].AcceptedCount)
	}
	if stats["git stash"].RejectedCount != 1 {
		t.Fatalf("expected rejected suggestion count 1, got %d", stats["git stash"].RejectedCount)
	}
}

func TestInspectSummaryCountsExecutionAwareOutcomes(t *testing.T) {
	t.Parallel()

	store := newOutcomeTestStore(t)
	ctx := context.Background()
	if err := store.EnsureSession(ctx, "session-1"); err != nil {
		t.Fatalf("EnsureSession: %v", err)
	}

	recordFeedback(t, store, FeedbackRecord{SuggestionID: 1, SessionID: "session-1", EventType: "accepted_buffer"})
	recordFeedback(t, store, FeedbackRecord{SuggestionID: 1, SessionID: "session-1", EventType: "executed_unchanged"})
	recordFeedback(t, store, FeedbackRecord{SuggestionID: 2, SessionID: "session-1", EventType: "accepted_buffer"})
	recordFeedback(t, store, FeedbackRecord{SuggestionID: 2, SessionID: "session-1", EventType: "executed_edited"})
	recordFeedback(t, store, FeedbackRecord{SuggestionID: 3, SessionID: "session-1", EventType: "rejected"})

	summary, err := store.InspectSummary(ctx)
	if err != nil {
		t.Fatalf("InspectSummary: %v", err)
	}

	if summary.AcceptedCount != 1 {
		t.Fatalf("expected accepted count 1, got %d", summary.AcceptedCount)
	}
	if summary.EditedCount != 1 {
		t.Fatalf("expected edited count 1, got %d", summary.EditedCount)
	}
	if summary.BufferedCount != 2 {
		t.Fatalf("expected buffered count 2, got %d", summary.BufferedCount)
	}
	if summary.RejectedCount != 1 {
		t.Fatalf("expected rejected count 1, got %d", summary.RejectedCount)
	}
}

func TestListReplayBenchmarkCandidatesUsesTerminalExecutionOutcome(t *testing.T) {
	t.Parallel()

	store := newOutcomeTestStore(t)
	ctx := context.Background()
	if err := store.EnsureSession(ctx, "session-1"); err != nil {
		t.Fatalf("EnsureSession: %v", err)
	}

	bufferOnlyID, err := store.CreateSuggestion(ctx, SuggestionRecord{
		SessionID:   "session-1",
		Buffer:      "git st",
		Suggestion:  "git status",
		Source:      "history",
		CWD:         "/tmp/repo",
		RepoRoot:    "/tmp/repo",
		Branch:      "main",
		ModelName:   "qwen",
		CreatedAtMS: 100,
	})
	if err != nil {
		t.Fatalf("CreateSuggestion(bufferOnly): %v", err)
	}
	editedID, err := store.CreateSuggestion(ctx, SuggestionRecord{
		SessionID:   "session-1",
		Buffer:      "git sh",
		Suggestion:  "git show --stat",
		Source:      "model",
		CWD:         "/tmp/repo",
		RepoRoot:    "/tmp/repo",
		Branch:      "main",
		ModelName:   "qwen",
		CreatedAtMS: 200,
	})
	if err != nil {
		t.Fatalf("CreateSuggestion(edited): %v", err)
	}

	recordFeedback(t, store, FeedbackRecord{
		SuggestionID:    bufferOnlyID,
		SessionID:       "session-1",
		EventType:       "accepted_buffer",
		Suggestion:      "git status",
		AcceptedCommand: "git status",
	})
	recordFeedback(t, store, FeedbackRecord{
		SuggestionID:    editedID,
		SessionID:       "session-1",
		EventType:       "accepted_buffer",
		Suggestion:      "git show --stat",
		AcceptedCommand: "git show --stat",
	})
	recordFeedback(t, store, FeedbackRecord{
		SuggestionID:    editedID,
		SessionID:       "session-1",
		EventType:       "executed_edited",
		Suggestion:      "git show --stat",
		AcceptedCommand: "git show --stat",
		ActualCommand:   "git show --stat HEAD~1",
	})

	rows, err := store.ListReplayBenchmarkCandidates(ctx, 10)
	if err != nil {
		t.Fatalf("ListReplayBenchmarkCandidates: %v", err)
	}

	if len(rows) != 1 {
		t.Fatalf("expected only the terminal edited candidate, got %d rows", len(rows))
	}
	if rows[0].FeedbackEvent != "executed_edited" {
		t.Fatalf("expected executed_edited feedback event, got %q", rows[0].FeedbackEvent)
	}
	if rows[0].ActualCommand != "git show --stat HEAD~1" {
		t.Fatalf("expected edited actual command, got %q", rows[0].ActualCommand)
	}
}

func TestListReplayBenchmarkCandidatesPrefersRequestModelName(t *testing.T) {
	t.Parallel()

	store := newOutcomeTestStore(t)
	ctx := context.Background()
	if err := store.EnsureSession(ctx, "session-1"); err != nil {
		t.Fatalf("EnsureSession: %v", err)
	}

	suggestionID, err := store.CreateSuggestion(ctx, SuggestionRecord{
		SessionID:        "session-1",
		Buffer:           "git st",
		Suggestion:       "git status",
		Source:           "history",
		CWD:              "/tmp/repo",
		RepoRoot:         "/tmp/repo",
		Branch:           "main",
		ModelName:        "",
		RequestModelName: "mistral-small:latest",
		CreatedAtMS:      100,
	})
	if err != nil {
		t.Fatalf("CreateSuggestion: %v", err)
	}

	recordFeedback(t, store, FeedbackRecord{
		SuggestionID:    suggestionID,
		SessionID:       "session-1",
		EventType:       "executed_unchanged",
		Suggestion:      "git status",
		AcceptedCommand: "git status",
		ActualCommand:   "git status",
	})

	rows, err := store.ListReplayBenchmarkCandidates(ctx, 10)
	if err != nil {
		t.Fatalf("ListReplayBenchmarkCandidates: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].ModelName != "mistral-small:latest" {
		t.Fatalf("expected request model name to win, got %q", rows[0].ModelName)
	}
}

func TestInspectSummaryIgnoresNonReturnedSuggestions(t *testing.T) {
	t.Parallel()

	store := newOutcomeTestStore(t)
	ctx := context.Background()
	if err := store.EnsureSession(ctx, "session-1"); err != nil {
		t.Fatalf("EnsureSession: %v", err)
	}

	if _, err := store.CreateSuggestion(ctx, SuggestionRecord{
		RequestID:       "req-1",
		AttemptIndex:    1,
		ReturnedToShell: false,
		ValidationState: "failed",
		SessionID:       "session-1",
		Buffer:          "git st",
		Suggestion:      "1. git push origin",
		Source:          "model",
		CWD:             "/tmp/repo",
		RepoRoot:        "/tmp/repo",
		Branch:          "main",
		LatencyMS:       90,
		CreatedAtMS:     100,
	}); err != nil {
		t.Fatalf("CreateSuggestion(non-returned): %v", err)
	}
	if _, err := store.CreateSuggestion(ctx, SuggestionRecord{
		RequestID:        "req-1",
		AttemptIndex:     0,
		ReturnedToShell:  true,
		ValidationState:  "passed",
		SessionID:        "session-1",
		Buffer:           "git st",
		Suggestion:       "git status",
		Source:           "model",
		CWD:              "/tmp/repo",
		RepoRoot:         "/tmp/repo",
		Branch:           "main",
		LatencyMS:        30,
		RequestLatencyMS: 120,
		CreatedAtMS:      200,
	}); err != nil {
		t.Fatalf("CreateSuggestion(returned): %v", err)
	}

	summary, err := store.InspectSummary(ctx)
	if err != nil {
		t.Fatalf("InspectSummary: %v", err)
	}

	if summary.SuggestionCount != 1 {
		t.Fatalf("expected only returned suggestions to count, got %d", summary.SuggestionCount)
	}
	if summary.AverageModelLatency != 120 {
		t.Fatalf("expected average latency from returned suggestion, got %v", summary.AverageModelLatency)
	}
}

func TestCreateSuggestionPersistsRetryMetadata(t *testing.T) {
	t.Parallel()

	store := newOutcomeTestStore(t)
	ctx := context.Background()
	if err := store.EnsureSession(ctx, "session-1"); err != nil {
		t.Fatalf("EnsureSession: %v", err)
	}

	suggestionID, err := store.CreateSuggestion(ctx, SuggestionRecord{
		RequestID:              "req-42",
		AttemptIndex:           2,
		ReturnedToShell:        false,
		ValidationState:        "failed",
		ValidationFailuresJSON: `[{"rule":"buffer_prefix","message":"did not begin with the current buffer"}]`,
		SessionID:              "session-1",
		Buffer:                 "git st",
		Suggestion:             "status --short",
		Source:                 "model",
		CWD:                    "/tmp/repo",
		RepoRoot:               "/tmp/repo",
		Branch:                 "main",
		CreatedAtMS:            100,
	})
	if err != nil {
		t.Fatalf("CreateSuggestion: %v", err)
	}

	var requestID string
	var attemptIndex int
	var returnedToShell int
	var validationState string
	var validationFailuresJSON string
	err = store.db.QueryRowContext(
		ctx,
		`SELECT request_id, attempt_index, returned_to_shell, validation_state, validation_failures_json
		 FROM suggestions
		 WHERE id = ?`,
		suggestionID,
	).Scan(&requestID, &attemptIndex, &returnedToShell, &validationState, &validationFailuresJSON)
	if err != nil {
		t.Fatalf("query suggestion retry metadata: %v", err)
	}

	if requestID != "req-42" || attemptIndex != 2 || returnedToShell != 0 || validationState != "failed" {
		t.Fatalf(
			"unexpected retry metadata request_id=%q attempt_index=%d returned_to_shell=%d validation_state=%q",
			requestID,
			attemptIndex,
			returnedToShell,
			validationState,
		)
	}
	if validationFailuresJSON == "" {
		t.Fatalf("expected validation failures json to persist")
	}
}

func newOutcomeTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := NewStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})
	return store
}

func recordFeedback(t *testing.T, store *Store, record FeedbackRecord) {
	t.Helper()
	if err := store.RecordFeedback(context.Background(), record); err != nil {
		t.Fatalf("RecordFeedback(%s): %v", record.EventType, err)
	}
}
