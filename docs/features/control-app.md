# Control App

The control app in `apps/console` is the local operations and analysis surface for `cli-auto-complete`.

## Purpose

It gives the project a usable local UI for:

- SQLite-backed analytics
- daemon runtime control
- ranking inspection
- model testing and saved benchmark runs
- exports and safe maintenance actions
- a minimal shared shell that keeps primary navigation and runtime status visible without duplicate footer shortcuts or topbar quick actions

## Main Sections

### Overview

Shows:

- daemon health
- active model
- socket and database paths
- totals for sessions, commands, suggestions, accepted, and rejected feedback
- recent suggestions
- latency by model
- acceptance by working directory path

### Suggestions

Shows paginated suggestion history with filters for:

- text query
- source
- model
- session
- cwd
- repo
- feedback outcome

### Commands And Feedback

Shows:

- executed command history
- session ids alongside each command and feedback event so session-scoped filters are discoverable
- recent feedback events
- top rejected suggestions
- acceptance rate by working directory path

### Ranking Inspector

Calls the daemon `/inspect` route to show:

- the winning candidate
- ranked alternatives
- per-candidate score breakdowns
- prompt text
- raw and cleaned model output
- previous command context
- buffer-required validation before requests are sent
- fresh error states that clear stale ranking results on failed requests
- a strategy selector for comparing `history-only`, `history+model`, and `model-only` behavior against the same prompt context
- automatic daemon recovery and retry when the console detects a stale pre-`/inspect` daemon process

### Model Lab

Supports:

- ad-hoc suggestion tests against one or more local models
- saved benchmark run history
- persisted benchmark results stored in SQLite
- model pickers that combine installed local Ollama models with the wider Ollama library catalog
- guardrails for empty or incomplete submissions before requests are sent
- reset and clear flows for benchmark and ad-hoc test forms
- clearer benchmark drill-down with a closable run detail view

### Daemon And Data Ops

Supports:

- start, stop, and restart
- runtime actions that wait for the daemon to become healthy before reporting successful start or restart
- runtime settings saved to `runtime.env`
- the same Ollama-aware model picker used in the lab
- a persisted suggestion-strategy selector shared with the daemon and shell runtime
- single-model runtime selection shown directly in the input instead of as a duplicate chip below it
- download prompts for models that are available in Ollama but not installed locally
- live pull-progress toasts while a model is downloading
- daemon path rows with hover actions to reveal items in Finder or open their directory in Terminal
- live PID fallback from process discovery when the pid file is missing or stale
- daemon log viewing
- destructive maintenance actions with typed confirmation

## Architectural Role

The control app is intentionally server-first:

- pages read SQLite directly from Next server code
- live operations go through local Next API routes
- the browser never talks directly to SQLite or the Unix socket daemon

This keeps the app local-only, simple to reason about, and aligned with the existing daemon and storage boundaries.
