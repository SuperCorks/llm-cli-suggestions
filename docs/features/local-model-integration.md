# Local Model Integration

The app is designed to keep inference local.

## Current Backend

- provider: Ollama
- adapter: `internal/model/ollama`
- default base URL: `http://127.0.0.1:11434`
- default model: `qwen2.5-coder:7b`
- default keep alive: `5m`

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
- a small selected set of recent session output snippets when they look relevant to the current buffer

The model is asked to return exactly one shell command on one line.

Each Ollama request also forwards the configured `keep_alive` value so the model can stay loaded between suggestions instead of paying a cold load on every idle gap.

## Why The Backend Boundary Is Useful

The shell does not know anything about Ollama directly. That makes it easier to:

- swap in another local backend later
- compare models without touching shell logic
- keep prompt generation and cleanup inside the Go implementation
