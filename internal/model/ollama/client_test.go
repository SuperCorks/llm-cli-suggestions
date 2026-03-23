package ollama

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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
	if response != "git status" {
		t.Fatalf("expected parsed response, got %q", response)
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
