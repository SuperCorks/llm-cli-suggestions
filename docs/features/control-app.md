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
- a dedicated performance dashboard for slicing latency by time window, including rolling, custom, and all-time presets, plus model, source, and cold versus hot model starts

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

### Performance

Shows:

- a server-rendered latency dashboard focused on end-to-end suggestion request time rather than only winner-model latency
- date and time filtering with presets for today, yesterday, last 24 hours, last 7 days, last 30 days, and custom windows
- current-model defaulting so the dashboard opens on the active daemon model without extra setup
- source and start-state filtering so you can isolate model-backed requests, history-only traffic, or rows with missing timing metadata
- cold versus hot start splits based on persisted Ollama load-duration metadata, with graceful fallback to an unknown state for historical rows that predate the instrumentation
- comparison against the immediately previous matching window for average latency, p95 latency, and cold-start share
- a Plotly-powered latency trend and latency-distribution charts for better date-axis handling and hover inspection
- a prompt-size-versus-latency chart that buckets stored prompt snapshots by size and overlays average plus p95 request latency
- request-phase breakdowns for load, prompt evaluation, decode, and non-model overhead
- path and buffer hotspot leaderboards for slow tails
- source-level latency cards to compare history, retrieval, and model-heavy traffic at a glance

### Suggestions

Shows paginated suggestion history with filters for:

- text query
- source from observed suggestion-source values in SQLite
- model
- session
- cwd
- feedback outcome
- quality label
- a hidden-by-default toggle for rows where model output was rejected because it did not start with the current buffer
- server-side sort modes for recency, latency, buffer ordering, model ordering, and labeled-first review
- page-size controls with top and bottom pagination affordances
- session ids directly in the history table for quicker cross-referencing with commands and feedback
- inline good/bad labeling that persists to SQLite for future evaluation and fine-tuning work
- empty recorded buffers rendered as a muted visual placeholder in the table and detail drawer without inserting fallback text into the hydrated DOM
- structured context previews on hover with persisted prompt snapshots, retrieved context, feedback outcome details, and replay links into the inspector
- copy-ready prompt and structured-context payloads from the hover card for debugging or dataset export prep
- a wider full-canvas layout on the suggestions explorer so the table can use the full screen width instead of the default content cap
- a collapsible Filters & Sort panel that starts closed so the history table stays primary while still surfacing active filter summaries
- a right-side detail drawer that flies over the page instead of shrinking the history table when a suggestion snapshot is opened
- automatic in-place refresh of the suggestions history every 2 seconds so newly logged rows appear without a manual reload while current filters and drawer state stay intact

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

- a leaner inspect form centered on `buffer`, optional `session id`, optional `cwd`, optional `repo root`, optional `branch`, optional `last exit code`, optional recent commands, installed-model pickers for slow and fast model selection, and strategy
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
- condensed saved benchmark run rows with a trailing info button that reveals the full run configuration on hover or click instead of keeping suite, protocol, repeat, timeout, and created columns always visible
- persisted benchmark results stored in SQLite
- track selection between static, replay, and raw benchmark modes
- timing protocol selection for cold-only, hot-only, mixed, and full passes
- replay sample-size control for live-DB benchmark runs
- installed-only model pickers for benchmarks and ad-hoc tests, with the wider Ollama library managed from the Models page
- stricter multi-model picker validation so models must exist in the local installed inventory before they can be added
- selection-first multi pickers that keep the textbox empty and rely on chips for the actual chosen models
- guardrails for empty or incomplete submissions before requests are sent
- reset and clear flows for benchmark and ad-hoc test forms
- benchmark run progress indicators with auto-refresh while queued or running
- fail-fast saved benchmark execution so hard model request errors stop the run early, preserve partial result rows, and surface the failure message in the saved run detail view
- comparison-first ad-hoc results and saved benchmark summaries that make model-to-model tradeoffs easier to scan
- richer benchmark drill-down with cold/hot latency cards, stage breakdowns, category/source tables, and filtered per-attempt rows
- replay actions on saved benchmark runs so a prior model set, repeat count, and timeout can be queued again directly from the run list

### Models

Supports:

- a dedicated Ollama inventory page for downloaded and library models
- pagination for the larger `Available From Ollama` catalog so library browsing stays usable without overwhelming the page
- supplemental family-page loading for important Ollama model families whose local tags do not reliably appear on the top-level library landing page, so models like `qwen3-coder` still show up in the console catalog
- capability chips on downloadable library models so vision, tools, and thinking support are visible at a glance
- parameter-size chips on installed and library entries, using Ollama parameter-size metadata for local models and catalog size labels for library entries when available
- context-window chips on installed and supported library entries, using Ollama local model metadata when a model is already downloaded and family-page catalog details when the public library exposes them
- model pickers that prioritize parameter size, context window, and capability chips over a generic available-state badge, while still marking installed and remote rows when that distinction matters
- exclusion of Ollama cloud-only catalog entries from the local console inventory so remote models do not appear as downloadable local options, while mixed cloud-plus-local families like `qwen3.5` still surface their local tags
- visible but disabled cloud and remote-only catalog entries, styled as greyed-out reference items so unsupported downloads are explicit instead of silently disappearing
- visibility into the daemon's configured model and the current live model
- a page-header `Update Ollama` action that appears as soon as the Models page detects the local Homebrew-managed Ollama install is behind the latest available version
- a dedicated `Installed Locally` operations panel that tracks both downloads and removals, survives page refreshes, supports multiple concurrent model jobs, and lets you cancel stalled work or dismiss cancelled and failed jobs
- inline `Update Ollama` recovery for failed download jobs that report the local Ollama version is too old, with the console running a Homebrew upgrade, restarting the local Ollama service, and then restarting the autocomplete daemon before clearing the operation
- automatic cleanup of completed model operations so finished downloads and removals drop out of the attention list once the inventory refreshes
- inline installed-model role actions for the progressive dual-model strategies, so any extra local model can be assigned as the fast-stage model or the large/slow-stage model without leaving the page
- live-role chips and green row accents for the currently assigned fast and slow models, with those rows pinned to the top of the installed list
- switching the assigned slow or fast model unloads any displaced Ollama resident model before the daemon restart, unless that same model still remains part of the next active runtime flow
- safe local model removal, with the currently assigned live model rows protected from removal
- searchable available-model catalog controls plus a compact dropdown multi-select size filter, while installed local models stay visible as a stable inventory list

### Daemon

Supports:

- start, stop, and restart
- daemon lifecycle actions that maintain a single active local daemon process even when the runtime form points at an alternate state dir or socket path
- runtime actions that wait for the daemon to become healthy before reporting successful start or restart
- runtime settings saved to `runtime.env`
- runtime model changes trigger a best-effort Ollama unload for any displaced or no-longer-active resident slow or fast model before the daemon restart, so stale model footprints do not linger until keep-alive expiry even when a fast model remains saved but is no longer part of the live strategy
- the same installed-only model picker used in the lab
- a persisted suggestion-strategy selector shared with the daemon and shell runtime
- an Ollama keep-alive setting persisted to `runtime.env` and applied on daemon inference requests so loaded models can stay warm longer between suggestions
- latency-oriented Ollama request shaping for live suggestions, with known thinking-capable models asked to skip reasoning when supported and `gpt-oss` constrained to the lowest documented reasoning level
- a multiline editor for the system prompt used by the daemon, prefilled with the built-in autosuggestion instructions and resettable back to that default
- a shell accept-key selector that persists whether `Tab` or Right Arrow accepts a visible suggestion in new shells, while leaving the non-selected key on its normal shell behavior
- shell-facing PTY capture mode selection plus allow-list and block-list editing, persisted to `runtime.env` so new shells can pick up the wrapper rules, with one exact command name or one `/regex/` per line so the UI can exclude only the interactive command shapes that the lightweight PTY shell tends to mangle
- single-model runtime selection shown directly in the input instead of as a duplicate chip below it
- download prompts for models that are available in Ollama but not installed locally
- live pull-progress toasts while a model is downloading
- a read-only runtime details panel for the model base URL, socket and database paths, and daemon file locations, with hover actions on filesystem paths to reveal items in Finder or open their directory in Terminal
- live PID fallback from process discovery when the pid file is missing or stale
- daemon process-memory rows that show the daemon RSS plus loaded-model memory, VRAM, and a tracked total, with dual-model strategies rendering separate slow and fast model rows so both configured footprints remain visible
- daemon status and memory rows that refresh while the page is open, without clobbering unsaved runtime form edits
- unloaded model-memory rows keep the last seen footprint for each configured model in a muted style, so the page preserves recent usage context without implying those models are still resident
- daemon log viewing through a live-updating stream with reconnect status in the panel header
- destructive maintenance actions with typed confirmation, placed after the log section so runtime inspection stays primary

## Architectural Role

The control app is intentionally server-first:

- pages read SQLite directly from Next server code
- live operations go through local Next API routes
- live dashboard and daemon tapes subscribe to local server-sent event routes exposed by Next
- the performance dashboard runs its aggregations server-side from filtered SQLite rows so percentile and phase calculations stay local and do not require browser-side data fetching
- the browser never talks directly to SQLite or the Unix socket daemon

This keeps the app local-only, simple to reason about, and aligned with the existing daemon and storage boundaries.
