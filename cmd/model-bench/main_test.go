package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/SuperCorks/llm-cli-suggestions/internal/api"
)

type fakeSuggestClient struct {
	suggest func(context.Context, string) (string, error)
}

func (c fakeSuggestClient) Suggest(ctx context.Context, prompt string) (string, error) {
	return c.suggest(ctx, prompt)
}

func testBenchmarkCases() []benchmarkCase {
	return []benchmarkCase{
		{
			Name: "case_one",
			Request: api.SuggestRequest{
				SessionID: "bench",
				Buffer:    "git st",
			},
			Acceptable: []string{"git status"},
		},
		{
			Name: "case_two",
			Request: api.SuggestRequest{
				SessionID: "bench",
				Buffer:    "npm run d",
			},
			Acceptable: []string{"npm run dev"},
		},
	}
}

func TestRunBenchmarksFailsFastOnFirstError(t *testing.T) {
	callCount := 0
	results, err := runBenchmarks(benchmarkConfig{
		models:   []string{"phi4"},
		repeat:   2,
		timeout:  50 * time.Millisecond,
		failFast: true,
		cases:    testBenchmarkCases(),
		newClient: func(modelName string) suggestClient {
			return fakeSuggestClient{suggest: func(context.Context, string) (string, error) {
				callCount++
				return "", errors.New("context deadline exceeded")
			}}
		},
	})
	if err == nil {
		t.Fatal("expected fail-fast benchmark error")
	}
	if !strings.Contains(err.Error(), "phi4") || !strings.Contains(err.Error(), "case_one") {
		t.Fatalf("expected model and case in error, got %q", err.Error())
	}
	if callCount != 1 {
		t.Fatalf("expected 1 call before fail-fast stop, got %d", callCount)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 partial result, got %d", len(results))
	}
	if results[0].Error == "" {
		t.Fatal("expected first result to record the request error")
	}
}

func TestRunBenchmarksCanContinueWhenFailFastDisabled(t *testing.T) {
	callCount := 0
	results, err := runBenchmarks(benchmarkConfig{
		models:   []string{"phi4"},
		repeat:   2,
		timeout:  50 * time.Millisecond,
		failFast: false,
		cases:    testBenchmarkCases(),
		newClient: func(modelName string) suggestClient {
			return fakeSuggestClient{suggest: func(context.Context, string) (string, error) {
				callCount++
				if callCount%2 == 1 {
					return "", errors.New("temporary model error")
				}
				return "git status", nil
			}}
		},
	})
	if err != nil {
		t.Fatalf("expected benchmark to continue when fail-fast is disabled: %v", err)
	}
	if callCount != 4 {
		t.Fatalf("expected all runs to execute, got %d calls", callCount)
	}
	if len(results) != 4 {
		t.Fatalf("expected 4 results, got %d", len(results))
	}
	if results[0].Error == "" || results[2].Error == "" {
		t.Fatal("expected odd-numbered runs to keep their errors")
	}
}
