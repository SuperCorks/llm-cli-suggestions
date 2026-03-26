package benchmark

import (
	"os"
	"path/filepath"
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

func TestBuildEvalExampleMarksExecutedUnchangedAsStrongPositive(t *testing.T) {
	example, ok := buildEvalExample(db.ReplayBenchmarkCandidate{
		SuggestionID:    43,
		Buffer:          "git st",
		SuggestionText:  "git status",
		AcceptedCommand: "git status",
		ActualCommand:   "git status",
		FeedbackEvent:   "executed_unchanged",
	})
	if !ok {
		t.Fatal("expected executed_unchanged replay candidate to become an eval example")
	}
	if example.Outcome != EvalOutcomeExecutedUnchanged {
		t.Fatalf("expected executed_unchanged outcome, got %q", example.Outcome)
	}
	if example.Confidence != EvalConfidenceStrong {
		t.Fatalf("expected strong confidence, got %q", example.Confidence)
	}
	if example.ExpectedCommand != "git status" {
		t.Fatalf("expected actual command target, got %q", example.ExpectedCommand)
	}
}

func TestBuildEvalExampleMarksExecutedEditedAsMediumPositive(t *testing.T) {
	example, ok := buildEvalExample(db.ReplayBenchmarkCandidate{
		SuggestionID:    44,
		Buffer:          "git st",
		SuggestionText:  "git status",
		AcceptedCommand: "git status",
		ActualCommand:   "git status --short",
		FeedbackEvent:   "executed_edited",
	})
	if !ok {
		t.Fatal("expected executed_edited replay candidate to become an eval example")
	}
	if example.Outcome != EvalOutcomeExecutedEdited {
		t.Fatalf("expected executed_edited outcome, got %q", example.Outcome)
	}
	if example.Confidence != EvalConfidenceMedium {
		t.Fatalf("expected medium confidence, got %q", example.Confidence)
	}
	if example.ExpectedCommand != "git status --short" {
		t.Fatalf("expected edited actual command target, got %q", example.ExpectedCommand)
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

func TestBuildEvalExampleCarriesEffectiveReplayModelName(t *testing.T) {
	example, ok := buildEvalExample(db.ReplayBenchmarkCandidate{
		SuggestionID:    13,
		Buffer:          "git st",
		SuggestionText:  "git status",
		AcceptedCommand: "git status",
		ActualCommand:   "git status",
		FeedbackEvent:   "executed_unchanged",
		ModelName:       "mistral-small:latest",
	})
	if !ok {
		t.Fatal("expected replay candidate to become an eval example")
	}
	if example.ModelName != "mistral-small:latest" {
		t.Fatalf("expected effective replay model name, got %q", example.ModelName)
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

func TestDecodeEvalDatasetSupportsWrappedJSON(t *testing.T) {
	payload, err := EncodeEvalDataset(EvalDataset{
		SchemaVersion: 1,
		Examples: []EvalExample{
			{ID: "one", Confidence: EvalConfidenceStrong},
		},
	})
	if err != nil {
		t.Fatalf("EncodeEvalDataset: %v", err)
	}

	dataset, err := DecodeEvalDataset(payload)
	if err != nil {
		t.Fatalf("DecodeEvalDataset: %v", err)
	}
	if len(dataset.Examples) != 1 || dataset.Examples[0].ID != "one" {
		t.Fatalf("unexpected wrapped dataset decode result: %+v", dataset.Examples)
	}
}

func TestDecodeEvalDatasetSupportsJSONL(t *testing.T) {
	payload, err := EncodeEvalDatasetJSONL([]EvalExample{
		{ID: "one", Confidence: EvalConfidenceStrong},
		{ID: "two", Confidence: EvalConfidenceMedium},
	})
	if err != nil {
		t.Fatalf("EncodeEvalDatasetJSONL: %v", err)
	}

	dataset, err := DecodeEvalDataset(payload)
	if err != nil {
		t.Fatalf("DecodeEvalDataset: %v", err)
	}
	if len(dataset.Examples) != 2 {
		t.Fatalf("expected 2 jsonl examples, got %d", len(dataset.Examples))
	}
}

func TestLoadEvalDatasetFromFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "eval.jsonl")
	payload, err := EncodeEvalDatasetJSONL([]EvalExample{{ID: "one"}})
	if err != nil {
		t.Fatalf("EncodeEvalDatasetJSONL: %v", err)
	}
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	dataset, err := LoadEvalDataset(path)
	if err != nil {
		t.Fatalf("LoadEvalDataset: %v", err)
	}
	if len(dataset.Examples) != 1 || dataset.Examples[0].ID != "one" {
		t.Fatalf("unexpected dataset from file: %+v", dataset.Examples)
	}
}

func TestEvalExamplesToCasesMarksOriginEval(t *testing.T) {
	cases := EvalExamplesToCases([]EvalExample{{
		ID:              "replay-1",
		LabelKind:       LabelKindPositive,
		CommandFamily:   "git",
		Request:         api.SuggestRequest{SessionID: "bench-replay", Buffer: "git st"},
		ExpectedCommand: "git status",
	}})
	if len(cases) != 1 {
		t.Fatalf("expected 1 case, got %d", len(cases))
	}
	if cases[0].Origin != "eval" {
		t.Fatalf("expected eval origin, got %q", cases[0].Origin)
	}
}
