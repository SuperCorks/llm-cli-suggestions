package benchmark

import (
	"testing"

	"github.com/SuperCorks/llm-cli-suggestions/internal/api"
	"github.com/SuperCorks/llm-cli-suggestions/internal/db"
)

func TestBuildEvalExampleMarksAcceptedAsMediumConfidencePositive(t *testing.T) {
	example, ok := buildEvalExample(db.ReplayBenchmarkCandidate{
		SuggestionID:    42,
		Buffer:          "git st",
		SuggestionText:  "git status",
		AcceptedCommand: "git status",
		FeedbackEvent:   "accepted",
		RepoRoot:        "/tmp/demo",
	})
	if !ok {
		t.Fatal("expected accepted replay candidate to become an eval example")
	}
	if example.LabelKind != LabelKindPositive {
		t.Fatalf("expected positive label, got %q", example.LabelKind)
	}
	if example.Outcome != EvalOutcomeAccepted {
		t.Fatalf("expected accepted outcome, got %q", example.Outcome)
	}
	if example.Confidence != EvalConfidenceMedium {
		t.Fatalf("expected medium confidence, got %q", example.Confidence)
	}
	if example.ExpectedCommand != "git status" {
		t.Fatalf("expected accepted command as target, got %q", example.ExpectedCommand)
	}
	if example.CommandFamily != "git" {
		t.Fatalf("expected git command family, got %q", example.CommandFamily)
	}
	if example.RepoName != "demo" {
		t.Fatalf("expected repo name demo, got %q", example.RepoName)
	}
}

func TestBuildEvalExamplePrefersManualGoodReviewAsStrongPositive(t *testing.T) {
	example, ok := buildEvalExample(db.ReplayBenchmarkCandidate{
		SuggestionID:   7,
		Buffer:         "npm t",
		SuggestionText: "npm test",
		QualityLabel:   "good",
		RepoRoot:       "/tmp/app",
	})
	if !ok {
		t.Fatal("expected reviewed-good replay candidate to become an eval example")
	}
	if example.Outcome != EvalOutcomeReviewedGood {
		t.Fatalf("expected reviewed_good outcome, got %q", example.Outcome)
	}
	if example.Confidence != EvalConfidenceStrong {
		t.Fatalf("expected strong confidence, got %q", example.Confidence)
	}
	if example.ExpectedCommand != "npm test" {
		t.Fatalf("expected suggestion text fallback as target, got %q", example.ExpectedCommand)
	}
}

func TestBuildEvalExampleMarksRejectedAsStrongNegative(t *testing.T) {
	example, ok := buildEvalExample(db.ReplayBenchmarkCandidate{
		SuggestionID:   12,
		Buffer:         "git branch",
		SuggestionText: "git branch --list",
		FeedbackEvent:  "rejected",
		ActualCommand:  "git branch",
	})
	if !ok {
		t.Fatal("expected rejected replay candidate to become an eval example")
	}
	if example.LabelKind != LabelKindNegative {
		t.Fatalf("expected negative label, got %q", example.LabelKind)
	}
	if example.Outcome != EvalOutcomeRejected {
		t.Fatalf("expected rejected outcome, got %q", example.Outcome)
	}
	if example.Confidence != EvalConfidenceStrong {
		t.Fatalf("expected strong confidence, got %q", example.Confidence)
	}
	if example.NegativeCommand != "git branch --list" {
		t.Fatalf("expected suggestion text as negative target, got %q", example.NegativeCommand)
	}
}

func TestFilterEvalExamplesByConfidence(t *testing.T) {
	filtered := FilterEvalExamplesByConfidence([]EvalExample{
		{ID: "medium", Confidence: EvalConfidenceMedium},
		{ID: "strong", Confidence: EvalConfidenceStrong},
	}, EvalConfidenceStrong)
	if len(filtered) != 1 {
		t.Fatalf("expected only strong example to remain, got %d", len(filtered))
	}
	if filtered[0].ID != "strong" {
		t.Fatalf("expected strong example to remain, got %q", filtered[0].ID)
	}
}

func TestEvalDedupKeyIncludesRepoRoot(t *testing.T) {
	left := evalDedupKey(EvalExample{
		LabelKind:       LabelKindPositive,
		Outcome:         EvalOutcomeAccepted,
		CommandFamily:   "git",
		RepoRoot:        "/tmp/one",
		ExpectedCommand: "git status",
		Request:         api.SuggestRequest{Buffer: "git st"},
	})
	right := evalDedupKey(EvalExample{
		LabelKind:       LabelKindPositive,
		Outcome:         EvalOutcomeAccepted,
		CommandFamily:   "git",
		RepoRoot:        "/tmp/two",
		ExpectedCommand: "git status",
		Request:         api.SuggestRequest{Buffer: "git st"},
	})
	if left == right {
		t.Fatal("expected repo-specific examples to keep distinct dedup keys")
	}
}
