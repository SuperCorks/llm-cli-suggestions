package model

import "context"

type SuggestMetrics struct {
	TotalDurationMS      int64
	LoadDurationMS       int64
	PromptEvalDurationMS int64
	EvalDurationMS       int64
	PromptEvalCount      int64
	EvalCount            int64
}

type SuggestResult struct {
	Response string
	Metrics  SuggestMetrics
}

type Client interface {
	Suggest(ctx context.Context, prompt string) (SuggestResult, error)
}
