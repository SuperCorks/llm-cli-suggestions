# AGENTS

## Project

`llm-cli-suggestions` is a local-only LLM-powered terminal autosuggestion tool for macOS `zsh`.

The project currently includes:

- a `zsh` plugin for async ghost-text suggestions and `Tab` acceptance
- a Go daemon exposed over a local Unix socket
- SQLite-backed logging for commands, suggestions, and feedback
- local model inference through Ollama
- benchmarking and shell smoke-test tooling

## Working Agreement

Keep the `docs/` directory up to date as the project evolves.

When you change Go-backed binaries such as the daemon, benchmark runner, or shell-facing client, make sure the affected executable in `bin/` is rebuilt before validating through direct shell or CLI flows. `npm run dev` now handles this automatically for console development by rebuilding the binaries and restarting the daemon first.

When behavior, architecture, tests, backlog priorities, or major features change, update the relevant files in:

- `docs/architecture.md`
- `docs/tests.md`
- `docs/features/`
- `docs/backlog/`
