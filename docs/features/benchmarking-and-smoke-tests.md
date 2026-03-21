# Benchmarking And Smoke Tests

The repo includes two important support features for development and tuning.

## Model Benchmarking

`cmd/model-bench` compares models across fixed command-completion cases.

It reports:

- latency
- whether the result is a valid continuation of the prefix
- whether the result matches an acceptable answer

This is the main tool for comparing local model choices and prompt changes.

## Shell Smoke Test

`scripts/smoke_zsh.sh` exercises the live shell integration end to end.

It verifies:

- daemon startup
- client health
- plugin loading
- `Tab` binding
- history-based suggestion acceptance
- rejection logging
- output-capture logging

## Why These Matter

## Console E2E Smoke Tests

`apps/console/e2e/console-smoke.spec.ts` uses Playwright to verify that the local control app renders and that a few key happy paths still work.

The suite runs against a seeded temporary SQLite state and currently covers:

- overview dashboard rendering
- suggestion and command explorer rendering
- ranking inspector interaction
- model lab benchmark details
- daemon settings and log display

## Why These Matter

The benchmark helps improve suggestion quality, the shell smoke test protects the terminal UX, and the console e2e suite protects the local admin UI. All three are useful because this project spans shell behavior, daemon behavior, and a browser-based control plane.
