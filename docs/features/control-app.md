# Control App

The control app in `apps/console` is the local operations and analysis surface for `llm-cli-suggestions`.

## Purpose

It gives the project a usable local UI for:

- SQLite-backed analytics
- daemon runtime control
- inspection
- model testing and saved benchmark runs
- exports and safe maintenance actions
- a minimal shared shell that keeps primary navigation and runtime status visible without duplicate footer shortcuts or topbar quick actions
- a collapsible left navigation so wider operational pages can reclaim horizontal space when needed

## Main Sections

### Overview

Shows:

- daemon health
- active model
- socket and database paths
- totals for sessions, commands, suggestions, accepted, and rejected feedback
- a live activity tape that auto-refreshes recent suggestion signals without a manual page reload
- recent suggestions
- latency by model
- acceptance by working directory path

### Suggestions

Shows paginated suggestion history with filters for:

- text query
- source from observed suggestion-source values in SQLite
- model
- session
- cwd
- feedback outcome
- quality label
- server-side sort modes for recency, latency, buffer ordering, model ordering, and labeled-first review
- page-size controls with top and bottom pagination affordances
- session ids directly in the history table for quicker cross-referencing with commands and feedback
- inline good/bad labeling that persists to SQLite for future evaluation and fine-tuning work
- structured context previews on hover with persisted prompt snapshots, retrieved context, feedback outcome details, and replay links into the inspector
- copy-ready prompt and structured-context payloads from the hover card for debugging or dataset export prep
- a wider full-canvas layout on the suggestions explorer so the table can use the full screen width instead of the default content cap
- a collapsible Filters & Sort panel that starts closed so the history table stays primary while still surfacing active filter summaries
- a right-side detail drawer that flies over the page instead of shrinking the history table when a suggestion snapshot is opened

### Commands And Feedback

Shows:

- executed command history
- compact command-context snapshots in the history table, with full cwd/repo/output details moved into a right-side slide-over drawer so long excerpts do not overwhelm the main table
- session ids alongside each command and feedback event so session-scoped filters are discoverable
- recent feedback events
- top rejected suggestions
- acceptance rate by working directory path

### Inspector

Calls the daemon `/inspect` route to show:

- a leaner inspect form centered on `buffer`, optional `session id`, optional `cwd`, optional `repo root`, optional `branch`, optional `last exit code`, optional recent commands, model choice, and strategy
- automatic context inference from `cwd` and session history when those fields are not pinned directly by a replayed suggestion snapshot
- the winning candidate
- ranked alternatives
- per-candidate score breakdowns
- retrieval-aware score breakdowns that distinguish history, local retrieval, and model contribution
- retrieved local context such as matching history commands, path candidates, git branches, matching project tasks, and the broader project task list loaded from local manifests
- prompt text
- raw and cleaned model output
- model timeout and invalid-output diagnostics when the daemon cannot produce a usable model candidate for an inspect request
- previous command context
- direct replay from saved suggestion snapshots with prefilled form state
- buffer-required validation before requests are sent
- fresh error states that clear stale ranking results on failed requests
- a strategy selector for comparing `history-only`, `history+model`, and `model-only` behavior against the same prompt context
- automatic daemon recovery and retry when the console detects a stale pre-`/inspect` daemon process
- a longer inspect-time model timeout floor than live shell suggestions so manual debugging remains usable even when the shell timeout is tuned aggressively low

### Model Lab

Supports:

- ad-hoc suggestion tests against one or more local models
- live runtime sync so the lab picks up the current daemon model and saved suggestion strategy on mount
- a per-test suggestion-strategy override for ad-hoc ranking requests
- ad-hoc tests that accept an optional `session id` and `cwd`, then let the backend infer repo root, branch, and recent session context when available
- saved benchmark run history
- persisted benchmark results stored in SQLite
- installed-only model pickers for benchmarks and ad-hoc tests, with the wider Ollama library managed from the Models page
- stricter multi-model picker validation so models must exist in the local installed inventory before they can be added
- selection-first multi pickers that keep the textbox empty and rely on chips for the actual chosen models
- guardrails for empty or incomplete submissions before requests are sent
- reset and clear flows for benchmark and ad-hoc test forms
- benchmark run progress indicators with auto-refresh while queued or running
- fail-fast saved benchmark execution so hard model request errors stop the run early, preserve partial result rows, and surface the failure message in the saved run detail view
- comparison-first ad-hoc results and saved benchmark summaries that make model-to-model tradeoffs easier to scan
- clearer benchmark drill-down with a closable run detail view

### Models

Supports:

- a dedicated Ollama inventory page for downloaded and library models
- pagination for the larger `Available From Ollama` catalog so library browsing stays usable without overwhelming the page
- supplemental family-page loading for important Ollama model families whose local tags do not reliably appear on the top-level library landing page, so models like `qwen3-coder` still show up in the console catalog
- capability chips on downloadable library models so vision, tools, and thinking support are visible at a glance
- exclusion of Ollama cloud-only catalog entries from the local console inventory so remote models do not appear as downloadable local options, while mixed cloud-plus-local families like `qwen3.5` still surface their local tags
- visible but disabled cloud and remote-only catalog entries, styled as greyed-out reference items so unsupported downloads are explicit instead of silently disappearing
- visibility into the daemon's configured model and the current live model
- a dedicated `Installed Locally` operations panel that tracks both downloads and removals, survives page refreshes, supports multiple concurrent model jobs, and lets you cancel stalled work or dismiss cancelled and failed jobs
- automatic cleanup of completed model operations so finished downloads and removals drop out of the attention list once the inventory refreshes
- safe local model removal, with the configured daemon model protected from removal
- searchable installed and available model lists so the page can act as the main Ollama control surface

### Daemon

Supports:

- start, stop, and restart
- runtime actions that wait for the daemon to become healthy before reporting successful start or restart
- runtime settings saved to `runtime.env`
- the same installed-only model picker used in the lab
- a persisted suggestion-strategy selector shared with the daemon and shell runtime
- an Ollama keep-alive setting persisted to `runtime.env` and applied on daemon inference requests so loaded models can stay warm longer between suggestions
- a multiline editor for the static system-prompt prefix that the daemon prepends ahead of the built-in autosuggestion prompt
- shell-facing PTY capture allow-list editing, persisted to `runtime.env` so new shells can pick up the wrapper list
- single-model runtime selection shown directly in the input instead of as a duplicate chip below it
- download prompts for models that are available in Ollama but not installed locally
- live pull-progress toasts while a model is downloading
- daemon path rows with hover actions to reveal items in Finder or open their directory in Terminal
- live PID fallback from process discovery when the pid file is missing or stale
- daemon process-memory rows that show the daemon RSS plus loaded-model memory, VRAM, and a tracked total, with an explicit unloaded-model state when Ollama has no active model resident
- daemon status and memory rows that refresh while the page is open, without clobbering unsaved runtime form edits
- unloaded model-memory rows keep the last seen footprint for the active model in a muted style, so the page preserves recent usage context without implying the model is still resident
- daemon log viewing through a live-updating stream with reconnect status in the panel header
- destructive maintenance actions with typed confirmation, placed after the log section so runtime inspection stays primary

## Architectural Role

The control app is intentionally server-first:

- pages read SQLite directly from Next server code
- live operations go through local Next API routes
- live dashboard and daemon tapes subscribe to local server-sent event routes exposed by Next
- the browser never talks directly to SQLite or the Unix socket daemon

This keeps the app local-only, simple to reason about, and aligned with the existing daemon and storage boundaries.
