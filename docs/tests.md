# Tests

This document describes the current test strategy and the checks that exist today.

## Current Automated Checks

### Console App Checks

Commands:

```bash
cd apps/console
npm run typecheck
npm run lint
npm run build
npm run e2e
```

These checks currently verify:

- App Router pages and API routes compile under TypeScript
- lint catches client and routing issues in the UI layer
- the production build succeeds with the server-side SQLite and daemon integrations wired in
- the Playwright e2e smoke suite can boot the app against a seeded local fixture and exercise the major happy paths

This is the current safety net for the control app until dedicated route and query tests are added.

### Console E2E Smoke Suite

Command:

```bash
cd apps/console
npm run e2e
```

The Playwright suite currently covers a seeded local happy path for:

- overview dashboard rendering
- suggestions explorer filtering
- commands and feedback rendering
- ranking inspector interaction with a mocked ranking response
- ranking inspector rendering of retrieved local context alongside candidate scores
- ranking inspector resilience when the daemon returns `null` prompt-context fields
- ranking inspector validation states, payload wiring, and API error handling
- ranking inspector strategy override coverage for `history-only`, `history+model`, and `model-only`
- ranking inspector `model-only` states for both successful raw model output and empty-output fallback rendering
- model lab guardrails, default state, and reset flows
- model lab benchmark queueing, refreshed run lists, closable detail views, and mouse-driven model selection
- model lab ad-hoc multi-model test results, picker interactions, and clear-results flow
- daemon page settings save flow, shared model-picker interactions, and log rendering
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
- filesystem retrieval for path-oriented buffers like `git add s`
- git branch retrieval for branch-oriented buffers like `git switch fea`
- prompt construction that includes retrieved local context

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

- `Tab` is bound to `lac-accept-or-complete`
- the daemon can be started and passed a health check
- a recorded command can be suggested back from history
- accepting a suggestion updates the buffer correctly
- rejecting a suggestion logs feedback correctly
- bounded output capture through `lac-capture` is recorded

This is the strongest automated test in the repo right now because it exercises the real integration boundary.

### Model Benchmark CLI

Command:

```bash
make bench-models
```

or:

```bash
./bin/model-bench -models qwen2.5-coder:7b
```

This is not a pass/fail test. It is a measurement tool for:

- latency
- valid prefix completion rate
- acceptable suggestion rate

It is useful for comparing local models and prompt changes against a fixed case list.

## Manual Validation We Have Used

In addition to the scripted checks, the current development workflow has relied on a few manual validations:

- starting a real `fancy` shell
- typing partial commands such as `git st`
- verifying that ghost text appears asynchronously
- confirming `Tab` accepts the suggestion
- confirming ghost text is rendered with muted highlighting
- opening the local control app and loading overview, suggestions, commands, ranking, lab, and daemon pages
- confirming daemon start or restart controls update runtime health
- running a benchmark from the control app and verifying rows persist in SQLite
- using the ranking inspector to confirm candidate breakdowns render correctly

These checks matter because terminal UX issues often do not show up in pure unit tests.

## What The Current Tests Cover Well

- daemon startup and socket health
- end-to-end shell integration
- command and feedback logging
- async suggestion delivery at a smoke-test level
- model comparison on representative cases
- console app compilation and route wiring
- persisted runtime settings flow from the control app into the shell startup path

## What The Current Tests Do Not Yet Cover Well

- broader unit tests for ranking behavior beyond the new retrieval-focused cases
- unit tests for prompt construction and suggestion cleanup
- dedicated database migration tests
- failure-mode integration tests for missing daemon or missing Ollama
- race-heavy shell behavior under rapid typing
- regression tests built from real accepted and rejected user suggestions
- focused tests for console query filters and export routes
- daemon control route tests from the control app surface
- benchmark job lifecycle tests for queue, run, and persistence behavior

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
