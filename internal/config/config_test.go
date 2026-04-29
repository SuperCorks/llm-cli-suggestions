package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadRuntimeEnvParsesLegacyMultilineQuotedValue(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	runtimeEnvPath := filepath.Join(dir, "runtime.env")
	contents := "LAC_SYSTEM_PROMPT_STATIC=\"line one\nline two\nline three\"\nLAC_MODEL_NAME=\"phi4\"\n"
	if err := os.WriteFile(runtimeEnvPath, []byte(contents), 0o644); err != nil {
		t.Fatalf("write runtime env: %v", err)
	}

	values, err := loadRuntimeEnv(runtimeEnvPath)
	if err != nil {
		t.Fatalf("load runtime env: %v", err)
	}

	if got, want := values["LAC_SYSTEM_PROMPT_STATIC"], "line one\nline two\nline three"; got != want {
		t.Fatalf("system prompt mismatch\nwant: %q\n got: %q", want, got)
	}
	if got, want := values["LAC_MODEL_NAME"], "phi4"; got != want {
		t.Fatalf("model name mismatch\nwant: %q\n got: %q", want, got)
	}
}

func TestLoadRuntimeEnvParsesShellEscapedSingleLineValue(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	runtimeEnvPath := filepath.Join(dir, "runtime.env")
	contents := "LAC_SYSTEM_PROMPT_STATIC=$'line one\\nquote: \\\"ok\\\"\\npath: C:\\\\tmp'\n"
	if err := os.WriteFile(runtimeEnvPath, []byte(contents), 0o644); err != nil {
		t.Fatalf("write runtime env: %v", err)
	}

	values, err := loadRuntimeEnv(runtimeEnvPath)
	if err != nil {
		t.Fatalf("load runtime env: %v", err)
	}

	if got, want := values["LAC_SYSTEM_PROMPT_STATIC"], "line one\nquote: \"ok\"\npath: C:\\tmp"; got != want {
		t.Fatalf("system prompt mismatch\nwant: %q\n got: %q", want, got)
	}
}

func TestNormalizeSuggestStrategyRecognizesProgressiveModes(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		SuggestStrategyHistoryOnly:              SuggestStrategyHistoryOnly,
		SuggestStrategyHistoryModel:             SuggestStrategyHistoryModel,
		SuggestStrategyHistoryModelAlways:       SuggestStrategyHistoryModelAlways,
		SuggestStrategyHistoryThenModel:         SuggestStrategyHistoryThenModel,
		SuggestStrategyHistoryThenFastThenModel: SuggestStrategyHistoryThenFastThenModel,
		SuggestStrategyFastThenModel:            SuggestStrategyFastThenModel,
		SuggestStrategyModelOnly:                SuggestStrategyModelOnly,
		"unknown":                               SuggestStrategyHistoryModel,
	}

	for input, want := range cases {
		if got := NormalizeSuggestStrategy(input); got != want {
			t.Fatalf("NormalizeSuggestStrategy(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestLoadDefaultsModelRetryEnabled(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("LAC_STATE_DIR", filepath.Join(dir, "state"))

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if !cfg.ModelRetryEnabled {
		t.Fatalf("expected model retry to default on")
	}
}

func TestLoadRuntimeEnvParsesModelRetryEnabled(t *testing.T) {
	dir := t.TempDir()
	stateDir := filepath.Join(dir, "state")
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatalf("mkdir state: %v", err)
	}
	runtimeEnvPath := filepath.Join(stateDir, "runtime.env")
	if err := os.WriteFile(runtimeEnvPath, []byte("LAC_MODEL_RETRY_ENABLED='false'\n"), 0o644); err != nil {
		t.Fatalf("write runtime env: %v", err)
	}

	t.Setenv("HOME", dir)
	t.Setenv("LAC_STATE_DIR", stateDir)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if cfg.ModelRetryEnabled {
		t.Fatalf("expected model retry to load false from runtime env")
	}
}
