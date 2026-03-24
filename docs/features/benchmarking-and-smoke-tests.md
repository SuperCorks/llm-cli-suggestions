# Benchmarking And Smoke Tests

The repo includes several checks and measurement tools that protect the shell UX, the local daemon, and the control app.

## Model Benchmarking

`cmd/model-bench` compares models across fixed command-completion cases.

It reports:

- latency
- whether the result is a valid continuation of the prefix
- whether the result matches an acceptable answer

This is the main tool for comparing local model choices and prompt changes.

The same benchmark workflow is also exposed through the control app Model Lab, which can queue saved runs, persist results to SQLite, and drill into per-model or per-case detail views.

## Shell Smoke Test

`scripts/smoke_zsh.sh` exercises the live shell integration end to end.

It verifies:

- daemon startup
- client health
- plugin loading
- `Tab` binding
- history-based suggestion acceptance
- rejection logging
- allowlisted PTY output capture
- blocklist PTY output capture with excluded-command bypass
- explicit bounded output capture
- redirection-aware skip behavior for shell-side capture

## Ghost Text Timing Test

`scripts/test_ghost_text.sh` drives real `zsh -dfi` sessions over `expect`, seeds suggestion history through the daemon, and records redraw snapshots through `LAC_SNAPSHOT_PATH`.

It is the focused regression test for async ghost-text rendering, because it checks that the live shell reaches a rendered state after an idle prefix without invalidating the request with extra editing input.

## Console E2E Smoke Tests

`apps/console/e2e/console-smoke.spec.ts` uses Playwright to verify that the local control app renders and that a few key happy paths still work.

The suite runs against a seeded temporary SQLite state and currently covers:

- overview dashboard rendering
- suggestion, command, and signal explorer rendering
- inspector interaction
- model lab queueing and benchmark details
- models inventory interactions
- daemon settings, PTY allow-list persistence, and log display

The benchmark helps improve suggestion quality, the shell smoke test protects the terminal UX, and the console e2e suite protects the local admin UI. All three are useful because this project spans shell behavior, daemon behavior, and a browser-based control plane.
