# Architecture

`cli-auto-complete` is a local-only autosuggestion system for macOS `zsh`.

The current implementation is built from five main pieces:

1. A `zsh` plugin in `zsh/cli-auto-complete.zsh`
2. A Go daemon in `cmd/autocomplete-daemon`
3. A small shell-facing client in `cmd/autocomplete-client`
4. A SQLite-backed storage layer in `internal/db`
5. A local model adapter, currently Ollama, in `internal/model/ollama`
6. A local Next.js control app in `apps/console`

## High-Level Flow

1. The user types in `zsh`.
2. The plugin watches buffer changes and schedules a debounced background request.
3. The background worker calls `autocomplete-client suggest`.
4. The client sends an HTTP request over a local Unix socket to the daemon.
5. The daemon builds a suggestion using local history, feedback, context, and optional model output.
6. The daemon stores the suggestion in SQLite.
7. The plugin receives the result asynchronously, renders the suffix as ghost text, and allows `Tab` to accept it.
8. When the command is executed, the plugin logs the command and feedback events back through the client and daemon into SQLite.
9. The control app reads the same SQLite database directly for analytics and uses local server routes for daemon control and experiments.

## Shell Layer

The shell layer is intentionally shallow. It is responsible for:

- tracking the current edit buffer
- scheduling async suggestions with a short debounce
- discarding stale requests
- rendering the suggestion as `POSTDISPLAY`
- styling the ghost text with `region_highlight`
- accepting the suggestion with `Tab`
- falling back to normal completion when no suggestion is present
- capturing command execution lifecycle via `preexec` and `precmd`

The plugin does not run model inference directly. That work stays outside the shell so typing remains responsive and the inference backend can evolve without rewriting the editor integration.

## Client And Transport

`autocomplete-client` is a thin CLI bridge between shell code and the daemon. It exposes these main commands:

- `health`
- `suggest`
- `feedback`
- `record-command`
- `inspect`

The transport is an HTTP API over a local Unix domain socket. This keeps the daemon local-only while still making the interface easy to evolve and inspect.

## Control App

The control app in `apps/console` is the local operations surface for the system.

It is intentionally hybrid:

- analytics pages query SQLite directly from Next server code
- control actions call local server routes that manage the daemon, run benchmark jobs, or export data

The current app sections are:

- overview
- suggestions
- commands and feedback
- ranking inspector
- model lab
- daemon and data ops

This keeps the browser simple while preserving a clean boundary between:

- user interface
- local runtime operations
- SQLite analytics
- daemon-facing debug and control actions

## Daemon

The daemon is the long-lived service process. It owns:

- socket lifecycle
- config loading
- model client initialization
- request handling
- storage access
- ranking and suggestion generation

The current HTTP routes are:

- `GET /health`
- `POST /suggest`
- `POST /feedback`
- `POST /command`
- `POST /inspect`

`/inspect` is a local-only debug route used by the control app. It returns ranked candidates, score breakdowns, prompt context, and raw or cleaned model output for a supplied prompt state.

## Suggestion Engine

The suggestion engine combines multiple local signals:

- recent commands from the current session
- historical command prefix matches
- cwd, repo root, and branch affinity
- acceptance and rejection feedback
- previous command context
- last command output excerpts when available
- optional local model output

The current ranking shape is:

1. gather prefix-matching history candidates
2. trust history immediately when one candidate is clearly dominant
3. otherwise ask the local model for one candidate
4. blend history, model, recent usage, feedback, and last-command context
5. store and return the top-ranked result

This keeps the system fast when history is strong and still allows the model to help in more ambiguous cases.

## Storage Model

SQLite is used as the single local state store. The main tables are:

- `sessions`
- `commands`
- `suggestions`
- `feedback_events`
- `benchmark_runs`
- `benchmark_results`

This database supports both runtime behavior and future learning work. It already stores enough information to build offline eval sets and personalized reranking later.

## Runtime Settings

Runtime settings now have a persisted local layer through `runtime.env` in the state directory.

The precedence is:

1. explicit environment variables
2. persisted values from `runtime.env`
3. code defaults

The control app writes this file, and the `zsh` plugin reads it before launching the daemon in `fancy` mode. That gives the app a durable way to control:

- model name
- model base URL
- suggestion strategy
- socket path
- SQLite path
- suggest timeout

The current strategy modes are:

- `history-only`
- `history+model`
- `model-only`

The daemon uses the persisted runtime strategy for live shell suggestions, while the ranking inspector can override it per inspect request for debugging and comparison.

## Local Model Layer

The current model backend is Ollama. The daemon sends a single prompt and expects a single-line command completion in response.

Current defaults:

- backend: Ollama
- base URL: `http://127.0.0.1:11434`
- model: `qwen2.5-coder:7b`

The backend boundary is intentionally narrow so other local providers can be added later without changing the shell or database layers.

## Async Design

The shell integration is asynchronous by design:

- each buffer change increments a request sequence
- the plugin writes the newest sequence to local state
- a background worker checks whether its request is still current before and after calling the client
- completed results are written to a per-request file
- the worker signals the shell
- the shell applies the newest result during redraw

This avoids blocking on model latency and prevents old results from overriding newer typing state.

## Current Boundaries

The current implementation is deliberately scoped:

- it is built for macOS and `zsh`
- it keeps all inference local
- it supports bounded output capture, not full PTY transcript capture
- it focuses on command-line autosuggestions, not a full terminal replacement
- it is designed to be started explicitly from the shell integration or the local control app rather than always running for every shell session

These boundaries keep the first version simple while preserving a path toward richer context and learning.
