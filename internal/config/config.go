package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

type Config struct {
	StateDir       string
	SocketPath     string
	DBPath         string
	ModelBaseURL   string
	ModelName      string
	SuggestTimeout time.Duration
}

func Load() (Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Config{}, fmt.Errorf("resolve home dir: %w", err)
	}

	stateDir := getenvDefault("LAC_STATE_DIR", filepath.Join(home, "Library", "Application Support", "cli-auto-complete"))
	socketPath := getenvDefault("LAC_SOCKET_PATH", filepath.Join(stateDir, "daemon.sock"))
	dbPath := getenvDefault("LAC_DB_PATH", filepath.Join(stateDir, "autocomplete.sqlite"))
	modelBaseURL := getenvDefault("LAC_MODEL_BASE_URL", "http://127.0.0.1:11434")
	modelName := getenvDefault("LAC_MODEL_NAME", "qwen2.5-coder:7b")
	suggestTimeoutMS := getenvDefaultInt("LAC_SUGGEST_TIMEOUT_MS", 1200)

	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		return Config{}, fmt.Errorf("create state dir: %w", err)
	}

	return Config{
		StateDir:       stateDir,
		SocketPath:     socketPath,
		DBPath:         dbPath,
		ModelBaseURL:   modelBaseURL,
		ModelName:      modelName,
		SuggestTimeout: time.Duration(suggestTimeoutMS) * time.Millisecond,
	}, nil
}

func getenvDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getenvDefaultInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
