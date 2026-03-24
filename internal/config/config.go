package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	StateDir           string
	RuntimeEnvPath     string
	SocketPath         string
	DBPath             string
	ModelBaseURL       string
	ModelName          string
	ModelKeepAlive     string
	SuggestStrategy    string
	SystemPromptStatic string
	SuggestTimeout     time.Duration
}

const (
	SuggestStrategyHistoryOnly  = "history-only"
	SuggestStrategyHistoryModel = "history+model"
	SuggestStrategyModelOnly    = "model-only"
	DefaultSystemPromptStatic   = `You are a shell autosuggestion engine.
Complete the current shell command with the single most likely next command.
Return exactly one shell command on one line.
Do not include markdown, backticks, bullets, labels, colons, explanations, comments, cwd annotations, or placeholders.
Never invent explanatory suffixes like paths, notes, or metadata.
The returned command must begin exactly with the current buffer.

examples:
buffer: git st
command: git status
buffer: npm run d
command: npm run dev
buffer: gcloud auth l
command: gcloud auth list`
)

func Load() (Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Config{}, fmt.Errorf("resolve home dir: %w", err)
	}

	stateDir := getenvDefault("LAC_STATE_DIR", filepath.Join(home, "Library", "Application Support", "llm-cli-suggestions"))
	runtimeEnvPath := filepath.Join(stateDir, "runtime.env")
	runtimeValues, err := loadRuntimeEnv(runtimeEnvPath)
	if err != nil {
		return Config{}, err
	}

	socketPath := firstNonEmpty(os.Getenv("LAC_SOCKET_PATH"), runtimeValues["LAC_SOCKET_PATH"], filepath.Join(stateDir, "daemon.sock"))
	dbPath := firstNonEmpty(os.Getenv("LAC_DB_PATH"), runtimeValues["LAC_DB_PATH"], filepath.Join(stateDir, "autocomplete.sqlite"))
	modelBaseURL := firstNonEmpty(os.Getenv("LAC_MODEL_BASE_URL"), runtimeValues["LAC_MODEL_BASE_URL"], "http://127.0.0.1:11434")
	modelName := firstNonEmpty(os.Getenv("LAC_MODEL_NAME"), runtimeValues["LAC_MODEL_NAME"], "qwen2.5-coder:7b")
	modelKeepAlive := firstNonEmpty(os.Getenv("LAC_MODEL_KEEP_ALIVE"), runtimeValues["LAC_MODEL_KEEP_ALIVE"], "5m")
	suggestStrategy := NormalizeSuggestStrategy(firstNonEmpty(
		os.Getenv("LAC_SUGGEST_STRATEGY"),
		runtimeValues["LAC_SUGGEST_STRATEGY"],
		SuggestStrategyHistoryModel,
	))
	systemPromptStatic := firstNonEmpty(os.Getenv("LAC_SYSTEM_PROMPT_STATIC"), runtimeValues["LAC_SYSTEM_PROMPT_STATIC"], DefaultSystemPromptStatic)
	suggestTimeoutMS := firstNonEmptyInt(os.Getenv("LAC_SUGGEST_TIMEOUT_MS"), runtimeValues["LAC_SUGGEST_TIMEOUT_MS"], 1200)

	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		return Config{}, fmt.Errorf("create state dir: %w", err)
	}

	return Config{
		StateDir:           stateDir,
		RuntimeEnvPath:     runtimeEnvPath,
		SocketPath:         socketPath,
		DBPath:             dbPath,
		ModelBaseURL:       modelBaseURL,
		ModelName:          modelName,
		ModelKeepAlive:     modelKeepAlive,
		SuggestStrategy:    suggestStrategy,
		SystemPromptStatic: systemPromptStatic,
		SuggestTimeout:     time.Duration(suggestTimeoutMS) * time.Millisecond,
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
	contents, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]string{}, nil
		}
		return nil, fmt.Errorf("read runtime env: %w", err)
	}

	values := map[string]string{}
	lines := strings.Split(strings.ReplaceAll(string(contents), "\r\n", "\n"), "\n")
	for index := 0; index < len(lines); index++ {
		line := strings.TrimSpace(lines[index])
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}

		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if strings.HasPrefix(value, "$'") {
			for findClosingQuoteIndex(value, '\'', 2) == -1 && index+1 < len(lines) {
				index += 1
				value += "\n" + lines[index]
			}
		} else if strings.HasPrefix(value, "\"") || strings.HasPrefix(value, "'") {
			quote := rune(value[0])
			for findClosingQuoteIndex(value, quote, 1) == -1 && index+1 < len(lines) {
				index += 1
				value += "\n" + lines[index]
			}
		}
		values[key] = decodeRuntimeEnvValue(value)
	}

	return values, nil
}

func findClosingQuoteIndex(value string, quote rune, start int) int {
	escaped := false
	for index := start; index < len(value); index++ {
		current := rune(value[index])
		if escaped {
			escaped = false
			continue
		}
		if current == '\\' {
			escaped = true
			continue
		}
		if current == quote {
			return index
		}
	}
	return -1
}

func decodeRuntimeEnvValue(value string) string {
	trimmed := strings.TrimSpace(value)
	if strings.HasPrefix(trimmed, "$'") && strings.HasSuffix(trimmed, "'") {
		return decodeANSICQuotedValue(trimmed[2 : len(trimmed)-1])
	}
	if len(trimmed) >= 2 && trimmed[0] == '"' && trimmed[len(trimmed)-1] == '"' {
		return decodeDoubleQuotedValue(trimmed[1 : len(trimmed)-1])
	}
	if len(trimmed) >= 2 && trimmed[0] == '\'' && trimmed[len(trimmed)-1] == '\'' {
		return trimmed[1 : len(trimmed)-1]
	}
	return trimmed
}

func decodeANSICQuotedValue(value string) string {
	var builder strings.Builder
	for index := 0; index < len(value); index++ {
		current := value[index]
		if current != '\\' {
			builder.WriteByte(current)
			continue
		}
		if index+1 >= len(value) {
			builder.WriteByte('\\')
			continue
		}
		index += 1
		switch value[index] {
		case 'n':
			builder.WriteByte('\n')
		case 'r':
			builder.WriteByte('\r')
		case 't':
			builder.WriteByte('\t')
		case '\\':
			builder.WriteByte('\\')
		case '\'':
			builder.WriteByte('\'')
		case '"':
			builder.WriteByte('"')
		default:
			builder.WriteByte(value[index])
		}
	}
	return builder.String()
}

func decodeDoubleQuotedValue(value string) string {
	var builder strings.Builder
	for index := 0; index < len(value); index++ {
		current := value[index]
		if current != '\\' {
			builder.WriteByte(current)
			continue
		}
		if index+1 >= len(value) {
			builder.WriteByte('\\')
			continue
		}
		index += 1
		switch value[index] {
		case 'n':
			builder.WriteByte('\n')
		case 'r':
			builder.WriteByte('\r')
		case 't':
			builder.WriteByte('\t')
		case '\\':
			builder.WriteByte('\\')
		case '\'':
			builder.WriteByte('\'')
		case '"':
			builder.WriteByte('"')
		default:
			builder.WriteByte(value[index])
		}
	}
	return builder.String()
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
