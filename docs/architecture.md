# Architecture

`llm-cli-suggestions` is a local-only autosuggestion system for macOS `zsh`.

The current implementation is built from six main pieces:

1. A `zsh` plugin in `zsh/llm-cli-suggestions.zsh`
2. A Go daemon in `cmd/autocomplete-daemon`
3. A small shell-facing client in `cmd/autocomplete-client`
4. A SQLite-backed storage layer in `internal/db`
5. A local model adapter, currently Ollama, in `internal/model/ollama`
6. A local Next.js control app in `apps/console`

## High-Level Flow

1. The user types in `zsh`.
2. The plugin watches buffer changes and schedules a debounced helper process.
3. The helper process calls `autocomplete-client suggest` once for classic modes, or multiple staged suggest requests for progressive modes, with the dual-model flow starting the fast-stage model before the slow-stage model to reduce backend contention.
4. The client sends an HTTP request over a local Unix socket to the daemon.
5. The daemon builds a suggestion using local history, feedback, context, and optional model output.
6. The daemon stores the suggestion in SQLite.
7. The plugin receives one or more stage results asynchronously, renders the current suffix as ghost text, and allows the configured accept key to accept it.
8. When the command is executed, the plugin logs the command and execution-aware feedback events back through the client and daemon into SQLite.
9. The control app reads the same SQLite database directly for analytics and uses local server routes for daemon control and experiments.

## Shell Layer

The shell layer is intentionally shallow. It is responsible for:

- tracking the current edit buffer
- scheduling async suggestions with a short debounce
- discarding stale requests
- ordering progressive-stage replacements so later lower-priority results cannot overwrite a newer higher-priority ghost text
- rendering the suggestion as `POSTDISPLAY`
- styling the ghost text with `region_highlight`
- accepting the suggestion with the configured accept key
- falling back to normal completion when no suggestion is present
- capturing command execution lifecycle and bounded output excerpts via `preexec` and `precmd`, with explicit wrappers for one-off capture (`lac-capture`, `lac-capture-pty`) and optional PTY capture that can run in allowlist or blocklist mode for external commands, using either exact command-name rules or `/regex/` rules that match the full raw command text and preparing wrappers lazily just before matching commands execute

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
- benchmark jobs persist rich JSON artifacts plus flattened SQLite result rows for the Model Lab
- live dashboard activity and daemon log panels subscribe to local server-sent event routes hosted by the same Next app

The current app sections are:

- overview
- performance
- suggestions
- commands and feedback
- inspector
- models
- model lab
- daemon

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

`/inspect` is a local-only debug route used by the control app. It returns ranked candidates, score breakdowns, retrieved local context, prompt context, and raw or cleaned model output for a supplied prompt state.

For inspect requests, the daemon now resolves missing context before scoring:

- if a `session_id` is present, it pulls the latest recorded command context and recent commands for that session
- if a `session_id` is present, it also pulls recent output-bearing commands from that session for prompt and scoring context
- if a session is new or sparse but `cwd` is present, it fills context gaps from the most recent commands seen in that working directory
- if a `cwd` is present, it can pull the most recent command context seen in that working directory
- if database context is incomplete but `cwd` is available, it falls back to lightweight local git inspection to infer repo root and branch

These independent local lookups now run in parallel so the engine spends less time waiting on separate SQLite reads before ranking starts.

That lets the control app keep ranking and ad-hoc test forms simple while still exercising the same context-aware engine behavior as the live shell flow.

## Suggestion Engine

The suggestion engine combines multiple local signals:

- recent commands from the current session
- historical command prefix matches
- targeted filesystem matches for the current token
- local and remote git branch matches when the buffer looks branch-oriented
- project task and script matches from files like `package.json`, `Makefile`, and `justfile`
- cwd, repo root, and branch affinity
- acceptance and rejection feedback
- previous command context
- last command output excerpts when available
- a small selected set of recent session output snippets when they look relevant
- optional local model output

The current ranking shape is:

1. resolve session- or cwd-scoped context, recent commands, and recent output context
2. gather prefix-matching history candidates
3. gather targeted local retrieval candidates for paths, branches, and project tasks while also loading broader local project task context for the prompt when available
4. run the independent history and local retrieval work in parallel when possible
5. trust history immediately when one candidate is clearly dominant in classic hybrid mode
6. otherwise ask the local model for one candidate, or always ask the model when the request is part of a progressive rerank stage
7. blend history, retrieval, model, recent usage, feedback, and last-command context
8. store and return the top-ranked result for that stage request

This keeps the system fast when local context is strong and still allows the model to help in more ambiguous cases.

For control-app inspection and ad-hoc model tests, the ranking entrypoint can also hydrate prompt context from the recorded command database before step 1, using session- or cwd-scoped history when possible.

## Storage Model

SQLite is used as the single local state store. The main tables are:

- `sessions`
- `commands`
- `suggestions`
- `feedback_events`
- `benchmark_runs`
- `benchmark_results`
- `suggestion_reviews`

This database supports both runtime behavior and future learning work. It already stores enough information to build offline eval sets and personalized reranking later.

The feedback lifecycle is now execution-aware rather than only buffer-aware:

- `accepted_buffer` records that the user accepted the ghost text into the prompt buffer
- `executed_unchanged` records that the accepted suggestion was later executed exactly as-is
- `executed_edited` records that the accepted suggestion was used as a starting point but edited before execution
- `rejected` records that a visible suggestion was bypassed and a different command ran instead

That split gives the ranking and eval pipeline a clearer distinction between strong positives, medium-confidence edited positives, and true negatives.

Suggestion rows now also persist the exact prompt text and a structured context snapshot used at decision time, so the control app can inspect and replay historical suggestions more faithfully.

They now also persist request-level timing fields alongside the older winner-candidate latency:

- end-to-end request latency for the stored suggestion
- request model name, even when the model was invoked but did not produce the winning suggestion
- the configured Ollama `keep_alive` value that was sent on that request
- a persisted live-request start-state classification (`hot`, `cold`, `unknown`, or `not-applicable`) using the same small warm-load tolerance as benchmarks
- Ollama total, load, prompt-eval, and eval durations
- Ollama prompt-eval and eval token counts

That lets the performance dashboard distinguish hot resident requests from cold wake-up requests and estimate how much of the tail comes from model loading versus other overhead in the engine or control path.

The daemon log now also emits one structured `suggest_trace` JSON line per live suggestion request with the effective request model, keep-alive setting, start-state classification, request latency, and Ollama timing breakdown so dashboard aggregates can be cross-checked against raw request traces.

The benchmark tables now store benchmark metadata separately from per-attempt rows:

- run-level metadata such as track, suite, strategy, timing protocol, sampled dataset size, and environment fingerprint
- per-attempt quality fields such as exact-match, alternative-match, negative-avoidance, and candidate-hit-at-3
- per-attempt timing fields such as request latency, model total/load/prompt/decode durations, token counts, decode throughput, and non-model overhead

Benchmark artifacts are also written to JSON so replay runs derived from the live database can be inspected and compared later even after the underlying suggestion history changes.

Because the detached benchmark worker, the console server, and the Go benchmark command can all touch the same SQLite file, both the Next.js and Go storage layers now enable WAL mode and a busy timeout. The engine inspect path also avoids session creation writes so read-only benchmark inspection does not introduce unnecessary lock contention.

## Runtime Settings

Runtime settings now have a persisted local layer through `runtime.env` in the state directory.

For the daemon and shell plugin, the precedence is:

1. explicit environment variables
2. persisted values from `runtime.env`
3. code defaults

The main exception is `fancy` mode in the `zsh` plugin: because `fancy` commonly re-execs a shell that inherits older exported `LAC_*` variables, the plugin prefers persisted `runtime.env` values over those inherited session exports for shell-facing runtime settings so fresh fancy shells pick up the latest saved strategy and fast-model configuration.

The control app is more defensive by default: it resolves from the standard state directory and persisted `runtime.env` instead of inheriting ambient `LAC_*` shell variables from whatever terminal launched Next. That avoids the console silently reading a stale socket or SQLite path when a development shell still exports older repo-specific values. For isolated runs like end-to-end tests, the console can opt back into process-environment overrides with `LAC_CONSOLE_USE_PROCESS_ENV_OVERRIDES=1`.

Runtime file overrides do not imply multi-daemon support. The shell startup path and the control-app daemon controls intentionally maintain one active `autocomplete-daemon` process at a time on the local machine, even if different state directories or socket paths are configured.

The control app writes this file, and the `zsh` plugin reads it before launching the daemon in `fancy` mode. When the control app changes the runtime model configuration, it compares the previous and next configured roles plus the previous and next active runtime flow, then sends a best-effort Ollama unload for any displaced or no-longer-active model unless that same tag is still needed by the next live strategy. That gives the app a durable way to control:

Persisted values are written as shell-sourceable single-line escaped assignments so multiline settings like the system prompt round-trip cleanly through the control app, `zsh`, and the Go daemon.

- model name
- optional fast-stage model name for progressive shell refinement
- model base URL
- suggestion strategy
- a configurable system prompt, seeded with the built-in autosuggestion instructions by default
- socket path
- SQLite path
- suggest timeout
- suggestion accept key
- PTY capture mode
- PTY capture allow-list, with one exact command name or `/regex/` rule per line
- PTY capture block-list, with one exact command name or `/regex/` rule per line

The current strategy modes are:

- `history-only`
- `history+model`
- `history-then-model`
- `history-then-fast-then-model`
- `fast-then-model`
- `model-only`

The daemon uses the persisted runtime strategy for live shell suggestions, while the inspector can override it per inspect request for debugging and comparison. Inspector requests also enforce a higher minimum model timeout than live shell suggestions because they are manual debug flows rather than latency-sensitive ghost-text updates.

When the control app replaces the configured slow or fast runtime model or changes which roles are active, it compares the old and new configured runtime roles alongside the old and new active runtime flow and sends a best-effort Ollama unload request for any displaced or no-longer-active resident model before the daemon restart. That keeps old model residency from lingering until keep-alive expiry, while still leaving models alone when the same tag remains needed by the next live strategy.

## Local Model Layer

The current model backend is Ollama. The daemon sends a single prompt and expects a single-line command completion in response.

For latency-sensitive suggestion traffic, the Ollama adapter now explicitly asks known thinking-capable model families to avoid reasoning traces when the API supports it. For `gpt-oss`, where Ollama documents only level-based reasoning controls, the adapter requests the lowest available thinking level instead of a full-off switch.

Current defaults:

- backend: Ollama
- base URL: `http://127.0.0.1:11434`
- model: `qwen2.5-coder:7b`

The backend boundary is intentionally narrow so other local providers can be added later without changing the shell or database layers.

## Async Design

The shell integration is asynchronous by design:

- each buffer change increments a request sequence
- each shell session gets its own async state directory under `LAC_ASYNC_DIR`
- the plugin writes the newest sequence to per-session local state
- a background worker checks whether its request is still current before and after calling the client
- completed results are written to a per-request file
- the worker writes to a per-session notify pipe
- a `zle -F` widget handler wakes the editor and applies the newest result during redraw

This avoids blocking on model latency and prevents old results from overriding newer typing state.

## Current Boundaries

The current implementation is deliberately scoped:

- it is built for macOS and `zsh`
- it keeps all inference local
- it supports bounded output capture, including a lightweight PTY wrapper that can target either an explicit allowlist or an all-except blocklist set of external commands, but not a full PTY interposer or complete terminal transcript system
- it focuses on command-line autosuggestions, not a full terminal replacement
- it is designed to be started explicitly from the shell integration or the local control app rather than always running for every shell session

These boundaries keep the first version simple while preserving a path toward richer context and learning.
