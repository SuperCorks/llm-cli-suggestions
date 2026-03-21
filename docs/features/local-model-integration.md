# Local Model Integration

The app is designed to keep inference local.

## Current Backend

- provider: Ollama
- adapter: `internal/model/ollama`
- default base URL: `http://127.0.0.1:11434`
- default model: `qwen2.5-coder:7b`

## Request Style

The daemon sends a single prompt that includes:

- current buffer
- cwd
- repo root
- branch
- last exit code
- recent commands
- previous command context
- bounded previous stdout/stderr when available

The model is asked to return exactly one shell command on one line.

## Why The Backend Boundary Is Useful

The shell does not know anything about Ollama directly. That makes it easier to:

- swap in another local backend later
- compare models without touching shell logic
- keep prompt generation and cleanup inside the Go implementation
