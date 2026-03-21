package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	StateDir       string
	RuntimeEnvPath string
	SocketPath     string
	DBPath         string
	ModelBaseURL   string
	ModelName      string
	SuggestStrategy string
	SuggestTimeout time.Duration
}

const (
	SuggestStrategyHistoryOnly  = "history-only"
	SuggestStrategyHistoryModel = "history+model"
	SuggestStrategyModelOnly    = "model-only"
)

func Load() (Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Config{}, fmt.Errorf("resolve home dir: %w", err)
	}

	stateDir := getenvDefault("LAC_STATE_DIR", filepath.Join(home, "Library", "Application Support", "cli-auto-complete"))
	runtimeEnvPath := filepath.Join(stateDir, "runtime.env")
	runtimeValues, err := loadRuntimeEnv(runtimeEnvPath)
	if err != nil {
		return Config{}, err
	}

	socketPath := firstNonEmpty(os.Getenv("LAC_SOCKET_PATH"), runtimeValues["LAC_SOCKET_PATH"], filepath.Join(stateDir, "daemon.sock"))
	dbPath := firstNonEmpty(os.Getenv("LAC_DB_PATH"), runtimeValues["LAC_DB_PATH"], filepath.Join(stateDir, "autocomplete.sqlite"))
	modelBaseURL := firstNonEmpty(os.Getenv("LAC_MODEL_BASE_URL"), runtimeValues["LAC_MODEL_BASE_URL"], "http://127.0.0.1:11434")
	modelName := firstNonEmpty(os.Getenv("LAC_MODEL_NAME"), runtimeValues["LAC_MODEL_NAME"], "qwen2.5-coder:7b")
	suggestStrategy := NormalizeSuggestStrategy(firstNonEmpty(
		os.Getenv("LAC_SUGGEST_STRATEGY"),
		runtimeValues["LAC_SUGGEST_STRATEGY"],
		SuggestStrategyHistoryModel,
	))
	suggestTimeoutMS := firstNonEmptyInt(os.Getenv("LAC_SUGGEST_TIMEOUT_MS"), runtimeValues["LAC_SUGGEST_TIMEOUT_MS"], 1200)

	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		return Config{}, fmt.Errorf("create state dir: %w", err)
	}

	return Config{
		StateDir:       stateDir,
		RuntimeEnvPath: runtimeEnvPath,
		SocketPath:     socketPath,
		DBPath:         dbPath,
		ModelBaseURL:   modelBaseURL,
		ModelName:      modelName,
		SuggestStrategy: suggestStrategy,
		SuggestTimeout: time.Duration(suggestTimeoutMS) * time.Millisecond,
	}, nil
}

func NormalizeSuggestStrategy(value string) string {
	switch strings.TrimSpace(value) {
	case SuggestStrategyHistoryOnly:
		return SuggestStrategyHistoryOnly
	case SuggestStrategyModelOnly:
		return SuggestStrategyModelOnly
	default:
		return SuggestStrategyHistoryModel
	}
}

func getenvDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func firstNonEmptyInt(primary, secondary string, fallback int) int {
	for _, value := range []string{primary, secondary} {
		if value == "" {
			continue
		}
		parsed, err := strconv.Atoi(value)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func loadRuntimeEnv(path string) (map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]string{}, nil
		}
		return nil, fmt.Errorf("open runtime env: %w", err)
	}
	defer file.Close()

	values := map[string]string{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}

		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		values[key] = value
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan runtime env: %w", err)
	}

	return values, nil
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
