# AGENTS

## Project

`cli-auto-complete` is a local-only LLM-powered terminal autosuggestion tool for macOS `zsh`.

The project currently includes:

- a `zsh` plugin for async ghost-text suggestions and `Tab` acceptance
- a Go daemon exposed over a local Unix socket
- SQLite-backed logging for commands, suggestions, and feedback
- local model inference through Ollama
- benchmarking and shell smoke-test tooling

## Working Agreement

Keep the `docs/` directory up to date as the project evolves.

When behavior, architecture, tests, backlog priorities, or major features change, update the relevant files in:

- `docs/architecture.md`
- `docs/tests.md`
- `docs/features/`
- `docs/backlog/`
