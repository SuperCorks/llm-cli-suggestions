package ollama

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSuggestIncludesKeepAlive(t *testing.T) {
	t.Parallel()

	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"response":"git status"}`))
	}))
	defer server.Close()

	client := New(server.URL, "qwen3-coder:latest", "30m")
	response, err := client.Suggest(context.Background(), "git st")
	if err != nil {
		t.Fatalf("suggest: %v", err)
	}
	if response.Response != "git status" {
		t.Fatalf("expected parsed response, got %q", response.Response)
	}
	if got := payload["keep_alive"]; got != "30m" {
		t.Fatalf("expected keep_alive 30m, got %#v", got)
	}
}

func TestSuggestOmitsKeepAliveWhenEmpty(t *testing.T) {
	t.Parallel()

	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"response":"git status"}`))
	}))
	defer server.Close()

	client := New(server.URL, "qwen3-coder:latest", "")
	if _, err := client.Suggest(context.Background(), "git st"); err != nil {
		t.Fatalf("suggest: %v", err)
	}
	if _, exists := payload["keep_alive"]; exists {
		t.Fatalf("expected keep_alive to be omitted, got %#v", payload["keep_alive"])
	}
}

func TestSuggestDisablesThinkingForSupportedModels(t *testing.T) {
	t.Parallel()

	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"response":"git status"}`))
	}))
	defer server.Close()

	client := New(server.URL, "qwen3:8b", "")
	if _, err := client.Suggest(context.Background(), "git st"); err != nil {
		t.Fatalf("suggest: %v", err)
	}

	if got := payload["think"]; got != false {
		t.Fatalf("expected think=false for qwen3, got %#v", got)
	}
}

func TestSuggestUsesLowestThinkingLevelForGptOss(t *testing.T) {
	t.Parallel()

	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"response":"git status"}`))
	}))
	defer server.Close()

	client := New(server.URL, "gpt-oss:20b", "")
	if _, err := client.Suggest(context.Background(), "git st"); err != nil {
		t.Fatalf("suggest: %v", err)
	}

	if got := payload["think"]; got != "low" {
		t.Fatalf("expected think=low for gpt-oss, got %#v", got)
	}
}

func TestSuggestOmitsThinkingControlForStandardModels(t *testing.T) {
	t.Parallel()

	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"response":"git status"}`))
	}))
	defer server.Close()

	client := New(server.URL, "llama3.2:latest", "")
	if _, err := client.Suggest(context.Background(), "git st"); err != nil {
		t.Fatalf("suggest: %v", err)
	}

	if _, exists := payload["think"]; exists {
		t.Fatalf("expected think to be omitted, got %#v", payload["think"])
	}
}

func TestSuggestRetriesWithoutThinkingControlWhenRejected(t *testing.T) {
	t.Parallel()

	payloads := make([]map[string]any, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer request.Body.Close()
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}

		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		payloads = append(payloads, payload)

		writer.Header().Set("Content-Type", "application/json")
		if len(payloads) == 1 {
			writer.WriteHeader(http.StatusBadRequest)
			_, _ = writer.Write([]byte(`{"error":"unknown field think"}`))
			return
		}
		_, _ = writer.Write([]byte(`{"response":"git status"}`))
	}))
	defer server.Close()

	client := New(server.URL, "qwen3:8b", "")
	response, err := client.Suggest(context.Background(), "git st")
	if err != nil {
		t.Fatalf("suggest: %v", err)
	}
	if response.Response != "git status" {
		t.Fatalf("expected parsed response, got %q", response.Response)
	}
	if len(payloads) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(payloads))
	}
	if got := payloads[0]["think"]; got != false {
		t.Fatalf("expected first request to include think=false, got %#v", got)
	}
	if _, exists := payloads[1]["think"]; exists {
		t.Fatalf("expected retry request to omit think, got %#v", payloads[1]["think"])
	}
}

func TestSuggestParsesTimingMetrics(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"response":"git status",
			"total_duration":2300000000,
			"load_duration":1500000000,
			"prompt_eval_duration":320000000,
			"eval_duration":410000000,
			"prompt_eval_count":48,
			"eval_count":16
		}`))
	}))
	defer server.Close()

	client := New(server.URL, "qwen3-coder:latest", "30m")
	response, err := client.Suggest(context.Background(), "git st")
	if err != nil {
		t.Fatalf("suggest: %v", err)
	}

	if response.Metrics.TotalDurationMS != 2300 {
		t.Fatalf("expected total duration 2300ms, got %d", response.Metrics.TotalDurationMS)
	}
	if response.Metrics.LoadDurationMS != 1500 {
		t.Fatalf("expected load duration 1500ms, got %d", response.Metrics.LoadDurationMS)
	}
	if response.Metrics.PromptEvalDurationMS != 320 {
		t.Fatalf("expected prompt eval duration 320ms, got %d", response.Metrics.PromptEvalDurationMS)
	}
	if response.Metrics.EvalDurationMS != 410 {
		t.Fatalf("expected eval duration 410ms, got %d", response.Metrics.EvalDurationMS)
	}
	if response.Metrics.PromptEvalCount != 48 {
		t.Fatalf("expected prompt eval count 48, got %d", response.Metrics.PromptEvalCount)
	}
	if response.Metrics.EvalCount != 16 {
		t.Fatalf("expected eval count 16, got %d", response.Metrics.EvalCount)
	}
}

func TestSuggestIncludesResponseBodyForNonRetryableErrors(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusBadRequest)
		_, _ = writer.Write([]byte(`{"error":"time: missing unit in duration \"-1\""}`))
	}))
	defer server.Close()

	client := New(server.URL, "qwen3-coder:latest", "-1")
	_, err := client.Suggest(context.Background(), "git st")
	if err == nil {
		t.Fatal("expected suggest to fail")
	}
	if !strings.Contains(err.Error(), `time: missing unit in duration`) {
		t.Fatalf("expected error body in message, got %q", err)
	}
}
