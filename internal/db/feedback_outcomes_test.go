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
