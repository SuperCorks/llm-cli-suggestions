package ollama

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/SuperCorks/llm-cli-suggestions/internal/model"
)

type Client struct {
	baseURL    string
	modelName  string
	keepAlive  string
	httpClient *http.Client
}

func New(baseURL, modelName, keepAlive string) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		modelName:  modelName,
		keepAlive:  strings.TrimSpace(keepAlive),
		httpClient: &http.Client{},
	}
}

func (c *Client) Suggest(ctx context.Context, prompt string) (model.SuggestResult, error) {
	payload := map[string]any{
		"model":  c.modelName,
		"prompt": prompt,
		"stream": false,
	}
	_, hasThinkControl := thinkControlForModel(c.modelName)
	if thinkValue, ok := thinkControlForModel(c.modelName); ok {
		payload["think"] = thinkValue
	}
	if c.keepAlive != "" {
		payload["keep_alive"] = c.keepAlive
	}

	response, err := c.doGenerate(ctx, payload)
	if err != nil {
		return model.SuggestResult{}, fmt.Errorf("call ollama: %w", err)
	}
	if response.StatusCode == http.StatusBadRequest && hasThinkControl {
		bodyText := readErrorBody(response)
		_ = response.Body.Close()
		if shouldRetryWithoutThink(bodyText) {
			delete(payload, "think")
			response, err = c.doGenerate(ctx, payload)
			if err != nil {
				return model.SuggestResult{}, fmt.Errorf("call ollama: %w", err)
			}
		} else {
			return model.SuggestResult{}, fmt.Errorf("ollama returned status %s: %s", response.Status, bodyText)
		}
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		bodyText := readErrorBody(response)
		if bodyText == "" {
			return model.SuggestResult{}, fmt.Errorf("ollama returned status %s", response.Status)
		}
		return model.SuggestResult{}, fmt.Errorf("ollama returned status %s: %s", response.Status, bodyText)
	}

	var parsed struct {
		Response           string `json:"response"`
		TotalDuration      int64  `json:"total_duration"`
		LoadDuration       int64  `json:"load_duration"`
		PromptEvalDuration int64  `json:"prompt_eval_duration"`
		EvalDuration       int64  `json:"eval_duration"`
		PromptEvalCount    int64  `json:"prompt_eval_count"`
		EvalCount          int64  `json:"eval_count"`
	}
	if err := json.NewDecoder(response.Body).Decode(&parsed); err != nil {
		return model.SuggestResult{}, fmt.Errorf("decode ollama response: %w", err)
	}

	return model.SuggestResult{
		Response: parsed.Response,
		Metrics: model.SuggestMetrics{
			TotalDurationMS:      durationToMS(parsed.TotalDuration),
			LoadDurationMS:       durationToMS(parsed.LoadDuration),
			PromptEvalDurationMS: durationToMS(parsed.PromptEvalDuration),
			EvalDurationMS:       durationToMS(parsed.EvalDuration),
			PromptEvalCount:      parsed.PromptEvalCount,
			EvalCount:            parsed.EvalCount,
		},
	}, nil
}

func readErrorBody(response *http.Response) string {
	if response == nil || response.Body == nil {
		return ""
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(body))
}

func shouldRetryWithoutThink(bodyText string) bool {
	normalized := strings.ToLower(strings.TrimSpace(bodyText))
	if normalized == "" {
		return true
	}
	return strings.Contains(normalized, "unknown field think") ||
		strings.Contains(normalized, "json: unknown field \"think\"")
}

func durationToMS(value int64) int64 {
	if value <= 0 {
		return 0
	}
	return value / int64(1_000_000)
}

func (c *Client) doGenerate(ctx context.Context, payload map[string]any) (*http.Response, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal ollama payload: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create ollama request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")

	return c.httpClient.Do(request)
}

func thinkControlForModel(modelName string) (any, bool) {
	normalized := strings.ToLower(strings.TrimSpace(modelName))
	if normalized == "" {
		return nil, false
	}

	switch {
	case strings.HasPrefix(normalized, "gpt-oss"):
		// Ollama documents GPT-OSS as supporting low/medium/high only, with no full-off mode.
		return "low", true
	case strings.HasPrefix(normalized, "qwen3"),
		strings.HasPrefix(normalized, "deepseek-r1"),
		strings.HasPrefix(normalized, "deepseek-v3.1"):
		return false, true
	default:
		return nil, false
	}
}
