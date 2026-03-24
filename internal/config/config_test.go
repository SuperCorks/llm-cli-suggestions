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
