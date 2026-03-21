package ollama

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type Client struct {
	baseURL    string
	modelName  string
	httpClient *http.Client
}

func New(baseURL, modelName string) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		modelName:  modelName,
		httpClient: &http.Client{},
	}
}

func (c *Client) Suggest(ctx context.Context, prompt string) (string, error) {
	payload := map[string]any{
		"model":  c.modelName,
		"prompt": prompt,
		"stream": false,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal ollama payload: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create ollama request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("call ollama: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ollama returned status %s", response.Status)
	}

	var parsed struct {
		Response string `json:"response"`
	}
	if err := json.NewDecoder(response.Body).Decode(&parsed); err != nil {
		return "", fmt.Errorf("decode ollama response: %w", err)
	}

	return parsed.Response, nil
}
