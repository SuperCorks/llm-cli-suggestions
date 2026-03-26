# Benchmarking And Smoke Tests

The repo includes several checks and measurement tools that protect the shell UX, the local daemon, and the control app.

## Model Benchmarking

`cmd/model-bench` now supports four benchmark tracks:

- `static` for curated repo-controlled regression cases
- `replay` for live-DB cases mined from executed, rejected, and manually reviewed suggestions
- `eval` for frozen exported eval datasets captured from earlier local usage
- `raw` for prompt/model-only diagnostics against the static suite

It also now supports a dedicated offline-eval export path:

- `export-eval` for confidence-labeled JSON or JSONL examples derived from the same replay mining flow

The default benchmark surface is end-to-end ranking through the engine, not raw model output.

It reports richer results than the original suite:

- positive exact-hit rate
- negative-avoidance rate
- valid-winner rate
- chars-saved ratio and candidate recall at 3
- mean, median, p90, p95, and max request latency
- cold vs hot timing splits
- model stage timing for load, prompt-eval, decode, and non-model overhead
- category and winner-source breakdowns

Timing can be forced with explicit protocols:

- `cold_only`
- `hot_only`
- `mixed`
- `full`

Useful commands:

```bash
make bench-static
make bench-replay
make bench-all
./bin/model-bench eval --dataset eval.jsonl --models qwen3-coder:latest --protocol mixed
./bin/model-bench raw --models qwen3-coder:latest --suite core
./bin/model-bench compare path/to/run-a.json path/to/run-b.json
./bin/model-bench mine-static --limit 25
./bin/model-bench export-eval --limit 250 --min-confidence strong --format jsonl --output eval.jsonl
```

`export-eval` is the first bridge from the live SQLite logs into a stable offline dataset. Each exported example can include:

- prompt-state request fields such as buffer, cwd, repo root, branch, and last exit code
- the stored prompt text and structured context snapshot when available
- repo and command-family metadata for later slicing and scorecards
- confidence labels that reflect what the current logging model really proves

The current confidence rules are intentionally conservative:

- manually reviewed `good` and `bad` suggestions are `strong`
- rejected suggestions are `strong`
- `executed_unchanged` suggestions are `strong`
- `executed_edited` suggestions are `medium`
- legacy `accepted` suggestions are `medium`, because they confirm the suggestion entered the buffer but do not prove the final executed command remained unchanged after later manual edits

The `eval` track lets that exported dataset become a stable benchmark input. That means you can freeze a recent local usage slice, rerun it later after ranking changes, and compare the same cases instead of depending on whatever the live SQLite history looks like that day.

Benchmark summaries for replay and eval runs now also include score breakdowns by:

- repo name
- command family

Those breakdowns are printed directly in the CLI summary so it is easier to see whether a change helps one workflow while hurting another.

The same benchmark workflow is also exposed through the control app Model Lab, which refreshes saved runs on page load, can queue or delete saved runs, persists results to SQLite, and drills into per-model or per-case detail views.

Saved `eval` runs can be inspected in the Model Lab, but replaying them still requires the CLI because the worker needs an explicit dataset path.

The saved-run detail view now also shows:

- a live worker log assembled from benchmark stdout and stderr
- the timestamp of the last worker event
- a stall warning when a queued or running benchmark has stopped emitting updates for an extended period

Saved benchmark rows also self-reconcile on the next read if the worker wrote a terminal artifact or logged a terminal error but failed to finish the final SQLite status update. That keeps visibly failed runs from getting stuck in `running` after a worker-side crash or finalization problem.

Fail-fast benchmark errors during hot-phase prewarm now still write a populated partial artifact and summary instead of bailing out with an empty benchmark artifact. The background worker also builds its `benchmark_results` insert from one shared column list so placeholder mismatches fail fast in code review instead of at runtime.

For hot-phase benchmark passes, the Ollama client now reuses the configured `keep_alive` duration instead of sending the invalid `-1` sentinel. Non-200 Ollama responses now include the response body in the surfaced error text so failures like invalid duration parsing are visible in the saved run.

The benchmark worker and Go runtime now also use SQLite WAL mode plus a busy timeout, and the engine's inspect path stays read-only instead of creating session rows. That reduces cross-process lock contention between the detached worker and the benchmark command when both touch the same local database.

Hot-phase benchmark rows now classify `start_state` using the requested timing phase plus a small warm-load tolerance, instead of treating any nonzero Ollama `load_duration` as a cold start. That keeps prewarmed runs with minor residual load time from being mislabeled as cold in saved results.

## Shell Smoke Test

`scripts/smoke_zsh.sh` exercises the live shell integration end to end.

It verifies:

- daemon startup
- client health
- plugin loading
- `Tab` binding
- history-based suggestion acceptance into the buffer
- unchanged execution and edited execution outcome logging
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
