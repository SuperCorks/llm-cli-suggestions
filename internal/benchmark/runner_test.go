package benchmark

import (
	"testing"
	"time"

	"github.com/SuperCorks/llm-cli-suggestions/internal/api"
	"github.com/SuperCorks/llm-cli-suggestions/internal/model"
)

func TestScoreAttemptPositiveExactMatch(t *testing.T) {
	attempt := AttemptResult{
		LabelKind:       LabelKindPositive,
		Request:         api.SuggestRequest{Buffer: "git st"},
		ExpectedCommand: "git status",
		WinnerCommand:   "git status",
		TopCandidates: []CandidatePreview{
			{Command: "git status", Source: "model", Score: 1},
		},
	}

	scoreAttempt(&attempt)

	if !attempt.ExactMatch {
		t.Fatal("expected exact match to be true")
	}
	if !attempt.ValidPrefix {
		t.Fatal("expected valid prefix to be true")
	}
	if !attempt.CandidateHitAt3 {
		t.Fatal("expected candidate recall@3 to be true")
	}
	if attempt.CharsSavedRatio <= 0 {
		t.Fatal("expected chars saved ratio to be positive")
	}
}

func TestScoreAttemptNegativeAvoidance(t *testing.T) {
	attempt := AttemptResult{
		LabelKind:      LabelKindNegative,
		Request:        api.SuggestRequest{Buffer: "git branch"},
		NegativeTarget: "git branch --list",
		WinnerCommand:  "git branch",
	}

	scoreAttempt(&attempt)

	if !attempt.NegativeAvoided {
		t.Fatal("expected negative avoidance to be true")
	}
	if attempt.ExactMatch {
		t.Fatal("did not expect positive exact match on a negative case")
	}
}

func TestStratifiedReplaySampleBalancesLabelsWhenPossible(t *testing.T) {
	values := []Case{
		{ID: "p1", Category: "git", LabelKind: LabelKindPositive},
		{ID: "p2", Category: "nav", LabelKind: LabelKindPositive},
		{ID: "p3", Category: "infra", LabelKind: LabelKindPositive},
		{ID: "n1", Category: "git", LabelKind: LabelKindNegative},
		{ID: "n2", Category: "nav", LabelKind: LabelKindNegative},
		{ID: "n3", Category: "infra", LabelKind: LabelKindNegative},
	}

	sampled := stratifiedReplaySample(values, 4)
	if len(sampled) != 4 {
		t.Fatalf("expected 4 sampled cases, got %d", len(sampled))
	}

	positive := 0
	negative := 0
	for _, value := range sampled {
		if value.LabelKind == LabelKindNegative {
			negative++
		} else {
			positive++
		}
	}
	if positive != 2 || negative != 2 {
		t.Fatalf("expected balanced sample, got positive=%d negative=%d", positive, negative)
	}
}

func TestAggregateAttemptsSummarizesQualityAndLatency(t *testing.T) {
	summary := aggregateAttempts([]AttemptResult{
		{
			LabelKind:        LabelKindPositive,
			ExactMatch:       true,
			ValidPrefix:      true,
			CandidateHitAt3:  true,
			CharsSavedRatio:  0.5,
			RequestLatencyMS: 100,
			StartState:       StartStateHot,
			WinnerSource:     "model",
			Category:         "git",
			Request:          api.SuggestRequest{RepoRoot: "/tmp/work/app-one"},
		},
		{
			LabelKind:        LabelKindNegative,
			NegativeAvoided:  true,
			RequestLatencyMS: 300,
			StartState:       StartStateCold,
			WinnerSource:     "history",
			Category:         "negatives",
			Request:          api.SuggestRequest{RepoRoot: "/tmp/work/app-two"},
		},
	})

	if summary.Quality.PositiveExactHitRate != 1 {
		t.Fatalf("expected positive exact hit rate 1, got %v", summary.Quality.PositiveExactHitRate)
	}
	if summary.Quality.NegativeAvoidRate != 1 {
		t.Fatalf("expected negative avoid rate 1, got %v", summary.Quality.NegativeAvoidRate)
	}
	if summary.Latency.Count != 2 {
		t.Fatalf("expected latency count 2, got %d", summary.Latency.Count)
	}
	if summary.Latency.Mean <= 0 {
		t.Fatalf("expected positive mean latency, got %v", summary.Latency.Mean)
	}
	if len(summary.RepoBreakdown) != 2 {
		t.Fatalf("expected repo breakdown entries, got %d", len(summary.RepoBreakdown))
	}
	if summary.RepoBreakdown[0].Label != "app-one" {
		t.Fatalf("expected first repo bucket to be app-one, got %q", summary.RepoBreakdown[0].Label)
	}
}

func TestKeepAliveForPhaseUsesConfiguredValueForHotRuns(t *testing.T) {
	config := RunConfig{ModelKeepAlive: "12m"}
	if value := keepAliveForPhase(config, TimingPhaseHot); value != "12m" {
		t.Fatalf("expected hot phase keep_alive to reuse configured value, got %q", value)
	}
}

func TestKeepAliveForPhaseFallsBackToDefaultForHotRuns(t *testing.T) {
	if value := keepAliveForPhase(RunConfig{}, TimingPhaseHot); value != "5m" {
		t.Fatalf("expected hot phase keep_alive fallback of 5m, got %q", value)
	}
}

func TestPrewarmTimeoutUsesMinimumFloor(t *testing.T) {
	if timeout := prewarmTimeout(5 * time.Second); timeout != minimumPrewarmTimeout {
		t.Fatalf("expected minimum prewarm timeout %v, got %v", minimumPrewarmTimeout, timeout)
	}
}

func TestPrewarmTimeoutPreservesLongerRequestTimeout(t *testing.T) {
	const requestTimeout = 45 * time.Second
	if timeout := prewarmTimeout(requestTimeout); timeout != requestTimeout {
		t.Fatalf("expected longer request timeout to be preserved, got %v", timeout)
	}
}

func TestClassifyStartStateKeepsHotPhaseWarmWithSmallResidualLoad(t *testing.T) {
	state := classifyStartState(TimingPhaseHot, false, model.SuggestMetrics{
		TotalDurationMS:      340,
		LoadDurationMS:       89,
		PromptEvalDurationMS: 183,
		EvalDurationMS:       62,
		PromptEvalCount:      191,
		EvalCount:            5,
	})
	if state != StartStateHot {
		t.Fatalf("expected hot phase with small residual load to remain hot, got %q", state)
	}
}

func TestClassifyStartStateMarksHotPhaseColdOnLargeReload(t *testing.T) {
	state := classifyStartState(TimingPhaseHot, false, model.SuggestMetrics{
		TotalDurationMS:      5758,
		LoadDurationMS:       5326,
		PromptEvalDurationMS: 339,
		EvalDurationMS:       67,
		PromptEvalCount:      191,
		EvalCount:            5,
	})
	if state != StartStateCold {
		t.Fatalf("expected hot phase with large load to be treated as cold, got %q", state)
	}
}

func TestClassifyStartStateTreatsExplicitColdPhaseAsCold(t *testing.T) {
	state := classifyStartState(TimingPhaseCold, false, model.SuggestMetrics{
		TotalDurationMS:      391,
		LoadDurationMS:       134,
		PromptEvalDurationMS: 196,
		EvalDurationMS:       50,
		PromptEvalCount:      183,
		EvalCount:            4,
	})
	if state != StartStateCold {
		t.Fatalf("expected explicit cold phase to stay cold, got %q", state)
	}
}
