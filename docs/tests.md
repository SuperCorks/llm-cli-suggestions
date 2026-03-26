# Tests

This document describes the current test strategy and the checks that exist today.

## Current Automated Checks

### Console App Checks

Commands:

```bash
eval "$(fnm env)"
fnm use "$(cat .node-version)"
cd apps/console
npm run typecheck
npm run lint
npm run build
npm run e2e
```

Run the console app checks with `fnm` first so they use the repo's pinned Node version from `.node-version`. The console package currently expects Node 24.

These checks currently verify:

- App Router pages and API routes compile under TypeScript
- lint catches client and routing issues in the UI layer
- the production build succeeds with the server-side SQLite and daemon integrations wired in
- the Playwright e2e smoke suite can boot the app against a seeded local fixture and exercise the major happy paths

This is the current safety net for the control app until dedicated route and query tests are added.

### Console E2E Smoke Suite

Command:

```bash
eval "$(fnm env)"
fnm use "$(cat .node-version)"
cd apps/console
npm run e2e
```

The Playwright suite currently covers a seeded local happy path for:

- overview dashboard rendering
- overview live-model cards for the current runtime mode
- performance dashboard rendering, filter wiring including the all-time preset, the default active-model analysis path, and the prompt-size-versus-latency panel
- shared shell navigation collapse and expand behavior
- suggestions explorer filtering
- suggestions explorer sorting, pagination, persisted good/bad grading, structured context hover previews, effective request-model attribution for progressive rows, matching model filtering for those rows, empty-buffer placeholder rendering without hydrated text rewrites, and 2-second in-place auto-refresh for newly logged rows
- commands and feedback rendering
- inspector interaction with a mocked ranking response
- inspector rendering of retrieved local context alongside candidate scores
- inspector resilience when the daemon returns `null` prompt-context fields
- inspector validation states, payload wiring, default live-strategy hydration, inferred-context form contract, and API error handling
- inspector strategy override coverage for `history-only`, `history+model`, `history-then-model`, `history-then-fast-then-model`, `fast-then-model`, and `model-only`
- inspector dual-model form defaults for fast and slow model inputs in progressive mode
- inspector staged progressive rendering for distinct history, fast-model, and slow-model suggestion cards
- inspector `model-only` states for successful raw model output, rejected-output explanations when the model does not match the current buffer, empty-output fallback rendering, and surfaced model timeout diagnostics
- model lab guardrails, default state, and reset flows
- model lab sync against live runtime defaults for current model and saved suggestion strategy
- model lab benchmark queueing, compact saved-run table rendering, hover/click run-info popovers, first-load saved-run refresh, replay actions from saved runs, per-run deletion for completed or failed runs, running-progress indicators, refreshed run lists, fail-fast failed-run handling with partial results, closable detail views, and stricter picker validation
- model lab ad-hoc multi-model test results, strategy overrides, session-or-cwd context wiring, picker interactions, and clear-results flow
- models page concurrent download, stable operation ordering during multi-download progress, in-place operation polling for multi-download progress, active-model quick switching for installed rows, tracked removal, refresh-safe operation hydration, automatic completed-job cleanup, stalled-job cancellation, dismissed cancelled jobs, available-catalog pagination, metadata-chip rendering for parameter size, context window, and capabilities, and dropdown multi-select size-filtering flows for local Ollama inventory management
- overview live activity stream updates through the browser EventSource client
- daemon page settings save flow, shared model-picker interactions, live log rendering, and danger-zone ordering below the log section
- daemon runtime strategy persistence through the shared settings form
- daemon-side model download prompt and progress handling for Ollama-backed runtime settings
- daemon control readiness and restart-failure handling
- daemon path hover actions for Finder and Terminal open helpers

The suite starts the Next app locally, seeds a temporary SQLite database, and uses deterministic fixture data so it does not depend on a live daemon or your personal shell history.

### Go Package Tests

Command:

```bash
make test
```

This runs:

```bash
go test ./...
```

This now verifies both package integrity and a first slice of focused engine behavior. The current Go tests cover:

- project-task retrieval for commands like `npm run d`
- empty-buffer suggestions that use the last recorded command as model context for typo correction or likely follow-up commands
- runtime-env parsing for multiline and escaped persisted system-prompt values
- strategy normalization for progressive shell modes and the internal always-rerank stage
- Ollama request payload wiring for configured `keep_alive` values
- benchmark hot-phase keep-alive selection so prewarm requests reuse a valid Ollama duration
- Ollama request payload wiring for no-thinking controls on known reasoning-capable models, with a lowest-level fallback for `gpt-oss`
- Ollama non-200 error propagation including the response body for actionable benchmark failure messages
- SQLite store startup pragmas for WAL mode and busy-timeout handling
- inspect remaining read-only so benchmark inspection does not create session rows
- progressive ranking stages still invoking the model even when history is already trusted
- replay benchmark candidate export preferring the effective request model when progressive rows invoked a model but the final winner stayed history-backed
- hot-phase benchmark classification tolerating small residual Ollama load durations instead of mislabeling warmed runs as cold
- filesystem retrieval for path-oriented buffers like `git add s`
- git branch retrieval for branch-oriented buffers like `git switch fea`
- retrieved history matches surfacing in inspect context and prompts
- cwd fallback for recent commands and recent output context when a session is new or has no recorded commands yet
- inspect responses exposing the last three command contexts, including their output excerpts
- recent-output selection that prefers relevant failure and branch context over unrelated session noise
- inspect responses and prompts that expose selected recent output context
- prompt construction with a configured static system-prompt prefix
- prompt construction that includes retrieved local context

There is also a focused engine microbenchmark for a mixed `git checkout fea` workload that exercises session context hydration, history lookup, path retrieval, and git branch retrieval together:

```bash
GOCACHE=/tmp/lac-gocache go test ./internal/engine -run '^$' -bench BenchmarkInspectGitCheckoutMixedRetrieval -benchmem
```

### Shell Smoke Test

Command:

```bash
make smoke-shell
```

This runs:

```bash
bash ./scripts/smoke_zsh.sh
```

The smoke test provisions a temporary state directory, launches a temp daemon, sources the `zsh` plugin in a clean interactive shell, and verifies the full shell-to-daemon loop.

It currently checks:

- `Tab` is bound to `lac-accept-or-complete` by default
- when `LAC_ACCEPT_KEY=right-arrow`, Right Arrow is bound to suggestion acceptance while `Tab` falls back to native completion
- the daemon can be started and passed a health check
- a recorded command can be suggested back from history
- an empty prompt can accept a full-command suggestion based on the last recorded command context
- accepting a suggestion updates the buffer correctly
- accepting a suggestion re-enters the shell buffer-change flow so a follow-up suggestion can be requested from the accepted prefix
- rejecting a suggestion logs feedback correctly
- non-allowlisted commands remain uncaptured by default
- allowlisted PTY capture records command output without stripping terminal behavior, including `/regex/` rules that match only specific raw command lines
- blocklist PTY capture wraps broad external command coverage while leaving excluded commands on the normal shell path, including `/regex/` rules that can exempt one exact command shape while still wrapping other invocations of the same binary
- PTY capture still applies when a wrapped command is prefixed with common shell modifiers or leading environment assignments
- stdout-redirected commands still remain uncaptured in the shell smoke path, while stderr-only redirection still preserves bounded stdout capture without printing or storing stderr
- bounded output capture through `lac-capture` is recorded

This is the strongest automated test in the repo right now because it exercises the real integration boundary.

### Ghost Text Timing Test

Command:

```bash
bash ./scripts/test_ghost_text.sh
```

This test uses `expect` to drive real `zsh -dfi` sessions over a pseudo-terminal, seeds history through the daemon API, and records redraw snapshots through `LAC_SNAPSHOT_PATH`.

It currently checks four isolated one-prefix idle sessions:

- `n`
- `npm `
- `npm p`
- `npm pr`

For each prefix, the test first confirms the daemon can produce a usable direct suggestion, then verifies the live shell reaches a `notify-applied` snapshot with a rendered suffix that matches the shell suggestion for that prefix plus the square-bracket source badge shown in ghost text.

This is the best targeted regression test for the shell timing issue because it leaves the shell idle after one prefix, avoids invalidating the in-flight request with extra editing input, and exercises the actual ZLE integration instead of only synchronous helper functions.

It also now validates the staged async-result file path for the current shell contract, because even `history-only` mode uses the same helper/result protocol as the progressive strategies.

### PTY Capture Regression Test

Command:

```bash
make pty-shell
```

This runs:

```bash
bash ./scripts/test_pty_capture.sh
```

This test uses `expect` to drive a real `zsh -dfi` session through the actual line-accept execution path instead of calling `_lac_preexec` and `_lac_precmd` directly.

It currently checks:

- the first matching PTY-captured command is wrapped in time on its very first interactive execution
- a `/regex/` allowlist rule can match the full raw command line
- stderr-only redirection such as `2>/dev/null` still preserves bounded stdout capture while keeping stderr out of both the terminal replay and stored suggestion context

This is the targeted regression test for the lazy PTY wrapper installation path because it exercises the exact failure mode that would not show up in the synchronous smoke harness.

### Model Benchmark CLI

Command:

```bash
make bench-static
make bench-replay
./bin/model-bench export-eval --limit 250 --min-confidence strong --format jsonl --output /tmp/eval.jsonl
./bin/model-bench eval --dataset /tmp/eval.jsonl --models qwen3-coder:latest --protocol mixed
```

or:

```bash
./bin/model-bench static --models qwen3-coder:latest --suite core --protocol full
./bin/model-bench replay --models qwen3-coder:latest --sample-limit 50 --protocol mixed
./bin/model-bench raw --models qwen3-coder:latest --suite core --protocol hot_only
```

This is primarily a measurement tool for:

- end-to-end quality across curated static cases
- end-to-end quality across replayed real usage from SQLite
- end-to-end quality across frozen exported eval datasets
- raw prompt/model diagnostics against the same static fixtures
- confidence-labeled offline eval export for later ranking or model-training work
- rich latency summaries, including cold vs hot runs and model stage timing

Saved artifacts now include sampled cases, aggregate summaries, and per-attempt rows so replay runs remain auditable even when they were created from the live database.

The eval export path now reuses that same replay-mining logic and writes either JSONL examples for downstream offline eval or one wrapped JSON payload when a single-file schema is more convenient. It now labels `executed_unchanged` suggestions as strong positives, `executed_edited` suggestions as medium positives, and reviewed or rejected suggestions as strong evidence, while keeping legacy `accepted` rows at medium confidence.

The eval benchmark track reads those exported datasets back in and runs the normal benchmark scoring loop against a frozen case set. Its CLI summary now prints repo and command-family breakdowns alongside the overall exact-match, valid-prefix, and negative-avoidance rates.

The CLI now fails fast by default when a model request errors. That stops wasting time on the rest of the matrix, writes whatever partial results have already been collected, and exits non-zero so the saved benchmark job can be marked failed instead of completed.

The control app also keeps a live per-run worker log and last-update timestamp in SQLite. That lets the benchmark detail view surface stdout/stderr while a run is active and warn when a queued or running benchmark appears stalled.

## Manual Validation We Have Used

In addition to the scripted checks, the current development workflow has relied on a few manual validations:

- starting a real `fancy` shell
- typing partial commands such as `git st`
- verifying that ghost text appears asynchronously
- confirming the configured accept key accepts the suggestion
- confirming ghost text is rendered with muted highlighting
- opening the local control app and loading overview, suggestions, signals, inspector, models, model lab, and daemon pages
- confirming daemon start or restart controls update runtime health
- confirming the commands page keeps context/output details in the slide-over drawer
- running a benchmark from the control app and verifying rows persist in SQLite
- using the inspector to confirm candidate breakdowns render correctly

These checks matter because terminal UX issues often do not show up in pure unit tests.

## What The Current Tests Cover Well

- daemon startup and socket health
- end-to-end shell integration
- command and feedback logging
- allowlisted PTY output capture for selected shell commands
- async suggestion delivery at a smoke-test level
- interactive ghost-text timing across isolated idle prefixes
- model comparison on representative cases
- console app compilation and route wiring
- persisted runtime settings flow from the control app into the shell startup path
- request-level latency instrumentation plumbed from Ollama through the daemon into SQLite, with compile-only Go coverage and a dedicated console smoke route for the new dashboard

## What The Current Tests Do Not Yet Cover Well

- broader unit tests for ranking behavior beyond the new retrieval-focused cases
- unit tests for prompt construction and suggestion cleanup
- dedicated database migration tests
- failure-mode integration tests for missing daemon or missing Ollama
- race-heavy shell behavior under rapid typing beyond the seeded prefix matrix
- regression tests built from real executed, edited, and rejected user suggestions
- focused tests for console query filters and export routes
- daemon control route tests from the control app surface
- benchmark job lifecycle tests for queue, run, and persistence behavior
- broader engine microbenchmarks for model-including paths and larger SQLite histories
- more unit tests around replay-case sampling and benchmark aggregation math
- end-to-end tests around eval-export output shape and filtering

## Recommended Next Test Additions

The highest-value additions would be:

1. ranking tests around history, feedback, and last-command context
2. database tests for suggestion and feedback queries
3. daemon API tests for `/suggest`, `/feedback`, and `/command`
4. console app query and route tests against seeded SQLite fixtures
5. benchmark job tests for persisted results and failure handling
6. offline eval tests driven by real local usage logs
7. shell behavior tests for stale-response discard and rapid input changes

We should also keep checking these practical scenarios during development:

- typing responsiveness with and without the daemon running
- behavior inside and outside git repos
- fallback behavior when the daemon or local model backend is unavailable

## Testing Philosophy

The current app sits at the boundary between shell UX, local inference, and persistent learning data. Because of that, the best long-term test mix is:

- unit tests for ranking and storage logic
- integration tests for daemon and client behavior
- smoke tests for real `zsh` behavior
- offline eval runs for suggestion quality

That combination should make it possible to improve quality without breaking the live terminal experience.
