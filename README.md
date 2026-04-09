# llm-cli-suggestions

**Local-first, context-aware terminal autosuggestions for macOS `zsh`.**

Type a few characters and a ghost-text smart suggestion appears inline. Suggestions are shaped by where you are and what you are doing: current working directory, repo root, git branch, recent commands, last exit code, recent command output, and local project tasks (e.g.`npm run`). Everything runs on your machine backed by a Go daemon, local Ollama model, and SQLite. No cloud, no API keys, no telemetry and blazingly fast (ai suggestions under 300ms).

<p align="center">
  <img src="docs/screenshots/zsh-ghost-text-terminal.png" width="100%" alt="Zsh ghost-text suggestions in the terminal" />
</p>


---

## Features

- [Ghost-text suggestions in zsh](#ghost-text-suggestions-in-zsh) - Async inline completions that stay out of your way until you want them.
- [Context-aware ranking](#context-aware-ranking) - Uses shell, repo, and project signals to shape the next suggestion.
- [Feedback loop from real usage](#feedback-loop-from-real-usage) - Buffered, executed, edited, and rejected outcomes feed back into local ranking.
- [Dashboard and live activity](#dashboard-and-live-activity) - Watch suggestion traffic, latency, and acceptance trends in one place.
- [Suggestion history and context snapshots](#suggestion-history-and-context-snapshots) - Browse every suggestion with timing, outcome, and full prompt context.
- [Commands and feedback inspection](#commands-and-feedback-inspection) - Review command history and feedback signals without losing detail.
- [Ranking inspector](#ranking-inspector) - Replay a prompt and inspect retrieval, scores, and raw model output.
- [Model lab and benchmarks](#model-lab-and-benchmarks) - Compare local models head-to-head on your real shell contexts.
- [Ollama model inventory](#ollama-model-inventory) - Download, switch, and manage local models from the control app.

### Ghost-text suggestions in zsh

Ghost-text completions appear inline as you type, with async debouncing so the shell stays responsive while the daemon works in the background.

**Highlights:**

- Accept with `Tab` by default, or switch to `Right Arrow ->` from the daemon settings page
- Blend local history, retrieved context, and Ollama output instead of relying on a single source
- Keep everything on-device through the local daemon, SQLite state, and Ollama

### Context-aware ranking

The same prefix can resolve differently depending on where you are and what just happened in the shell.

**Signals used for ranking:**

- current working directory, repo root, and git branch
- recent commands, last exit code, and recent command output
- local project tasks from files like `package.json`, `Makefile`, and `justfile`
- filesystem paths plus acceptance and rejection history

### Feedback loop from real usage

Every command, suggestion, buffer acceptance, execution outcome, and rejection is logged locally and fed back into ranking.

**What this enables:**

- frequently accepted patterns rise faster
- repeatedly rejected suggestions lose priority
- the control app can surface quality trends and path-level behavior over time
- (future) trigger model fine tuning to get even more personalized suggestions 

### Dashboard and live activity

The local console keeps the live signal stream, recent suggestions, and path-level acceptance trends in one place.

**Includes:**

- live daemon activity as suggestions and commands flow through the system
- summary cards for acceptance, latency, and top command usage
- lower-level panels for recent suggestions, model summary, and path-level performance

<p align="center">
  <img src="docs/screenshots/console-dashboard-overview.png" width="100%" alt="Dashboard — live activity stream, top commands, acceptance rate, and model latency at a glance." />
</p>

<p align="center">
  <img src="docs/screenshots/console-dashboard-with-suggestions.png" width="100%" alt="Dashboard lower panels showing recent suggestions, model summary, and acceptance by path" />
</p>

### Suggestion history and context snapshots

Browse every suggestion the engine has made, with timing, model, outcome, and full context snapshots.

**Includes:**

- filters for narrowing down recent behavior
- labels and outcomes for accepted, edited, buffered, rejected, and ignored suggestions
- stored prompt context so you can inspect what the engine actually saw

<p align="center">
  <img src="docs/screenshots/console-suggestions-history.png" width="100%" alt="Suggestion history table with filters, labels, and context snapshots" />
</p>

### Commands and feedback inspection

Review executed commands, feedback trends, and command-level context without crowding the main table with full output excerpts.

**Includes:**

- recent executed commands alongside feedback events
- filters for rejected suggestions and behavior patterns
- enough context to understand what the user did without turning the page into a raw log dump

<p align="center">
  <img src="docs/screenshots/console-commands-and-feedback.png" width="100%" alt="Commands and feedback page with filters, rejected suggestions, and recent feedback events" />
</p>

### Ranking inspector

Replay any prompt context, inspect candidate scores, retrieval signals, and raw model output.

**Includes:**

- prompt replay for a single suggestion case
- candidate scoring and retrieval breakdowns
- raw model output for ranking and debugging work

<p align="center">
  <img src="docs/screenshots/console-inspector.png" width="100%" alt="Ranking inspector showing candidate scores and prompt context" />
</p>

### Model lab and benchmarks

Queue repeatable benchmark runs across multiple models, compare latency and acceptance, and drill into individual results.

**Includes:**

- ad-hoc benchmark jobs from the console
- saved run history with progress and summary metrics
- per-case drill-downs to inspect where a model won or failed

<p align="center">
  <img src="docs/screenshots/console-model-lab-benchmarks.png" width="100%" alt="Model lab page for ad-hoc tests and queued benchmark runs" />
</p>

<p align="center">
  <img src="docs/screenshots/console-benchmark-runs-list.png" width="100%" alt="Saved benchmark runs list with progress, models, and detail actions" />
</p>

<p align="center">
  <img src="docs/screenshots/console-benchmark-run-detail.png" width="100%" alt="Benchmark run detail showing per-model summaries and per-case results" />
</p>

### Ollama model inventory

Browse the full Ollama library, download models, and switch the active daemon model without leaving the console.

**Includes:**

- installed and available model inventory in one place
- download actions for models you do not have yet
- a top-right Ollama update action when the local Homebrew-managed install is behind the latest available version
- quick switching of the daemon's active local model

<p align="center">
  <img src="docs/screenshots/console-models-inventory.png" width="100%" alt="Model inventory with installed and available models" />
</p>

---

## Quick Start

### Prerequisites

- macOS with `zsh`
- [Go 1.21+](https://go.dev/dl/)
- [Ollama](https://ollama.com/) running locally with at least one model pulled (e.g. `ollama pull qwen2.5-coder:7b`)
- [Node 24+](https://nodejs.org/) (for the control app only)

### Install and run

```bash
git clone https://github.com/SuperCorks/llm-cli-suggestions.git
cd llm-cli-suggestions
make build
```

If you change Go-backed commands later, `npm run dev` rebuilds the local binaries and restarts the daemon automatically for console development. If you are testing direct shell or CLI flows without the console dev server, rebuild the affected binary yourself, for example with `make build` or `go build -o bin/autocomplete-daemon ./cmd/autocomplete-daemon`.

Start the daemon:

```bash
./bin/autocomplete-daemon
```

Load the zsh plugin:

```bash
source "$PWD/zsh/llm-cli-suggestions.zsh"
lac-start-daemon
```

For a persistent setup, use the absolute clone path in your `.zshrc` so it works from any directory:

```bash
source "/absolute/path/to/llm-cli-suggestions/zsh/llm-cli-suggestions.zsh"
lac-start-daemon
```

That's it — start typing and suggestions will appear.

---

## How It Works

```
You type → zsh plugin debounces helper → autocomplete-client → local daemon → ghost-text renders
                                                               │
                                         ┌─────────────────────┼─────────────────────┐
                                         │                     │                     │
                                   SQLite history         Local retrieval      Ollama model
                                   + feedback             (paths, branches,   (only when
                                   + prompt snapshots     tasks, output)      history is not
                                                                                 decisive)
                                         │                     │                     │
                                         └─────────────────────┼─────────────────────┘
                                                               │
                                                     Ranked blend → top suggestion
```

The suggestion engine blends signals from:

1. **Command history** — prefix matching with repo, branch, and cwd affinity scoring
2. **Local model** — Ollama inference with bounded timeout, only called when history isn't confident enough
3. **Retrieved context** — filesystem paths, git branches, project tasks (npm/make/just), and recent command output
4. **Feedback loop** — unchanged executions get the strongest boost, edited executions stay as medium-confidence positives, and rejected suggestions get penalized

That means the same prefix can lead to different suggestions depending on where you are. `git ch` inside one repo can favor a branch that exists there, `npm run` can surface scripts from the current project, and a failed command can bias the next suggestion toward a likely fix.

The control app reads the same local state for analytics, inspection, benchmarking, runtime settings, and daemon operations.

---

## Configuration

The daemon uses sensible defaults:

| Setting | Default | Env var |
|---|---|---|
| Socket | `~/Library/Application Support/llm-cli-suggestions/daemon.sock` | `LAC_SOCKET_PATH` |
| Database | `~/Library/Application Support/llm-cli-suggestions/autocomplete.sqlite` | `LAC_DB_PATH` |
| Model | `qwen2.5-coder:7b` | `LAC_MODEL_NAME` |
| Ollama URL | `http://127.0.0.1:11434` | `LAC_MODEL_BASE_URL` |
| Ollama keep alive | `5m` | `LAC_MODEL_KEEP_ALIVE` |
| System Prompt | built-in shell autosuggestion prompt | `LAC_SYSTEM_PROMPT_STATIC` |
| Suggest timeout | `1200ms` | `LAC_SUGGEST_TIMEOUT_MS` |
| Accept key | `tab` | `LAC_ACCEPT_KEY` |

Settings saved from the control app persist to `runtime.env` and are picked up by new shells automatically.
When a new shell runs `lac-start-daemon`, the plugin now also replaces an already-healthy daemon if the daemon binary or persisted `runtime.env` settings are newer than the running instance, so fresh fancy shells do not stay attached to stale daemon builds.
When a shell is started through `fancy`, the plugin also prefers persisted `runtime.env` values over inherited exported `LAC_*` variables from the previous shell session, so stale strategy or fast-model exports do not suppress staged badges like `[ai/fast]` or `[ai/slow]`.

---

## Control App

The local Next.js control app lives in `apps/console`:

```bash
cd apps/console
npm install
npm run dev
```

Open the local URL shown by Next.js to access the dashboard, suggestions, signals, inspector, models, model lab, and daemon controls.

`npm run dev` now rebuilds the Go-backed binaries and restarts the local daemon before Next.js starts, so console changes do not accidentally talk to stale daemon or benchmark code.

The console app resolves its runtime paths from the standard state directory and persisted `runtime.env` by default, so it does not accidentally inherit stale `LAC_*` variables from the shell used to launch `next dev`. If you intentionally want to inspect or edit an alternate state dir or SQLite file through process env, also set `LAC_CONSOLE_USE_PROCESS_ENV_OVERRIDES=1`. Daemon start, stop, and restart still enforce a single active local daemon process at a time, so switching to an alternate state dir replaces the currently running daemon instead of running both in parallel.

The Daemon page also lets you edit the full system prompt used for shell autosuggestions, choose whether `Tab` or Right Arrow accepts a suggestion in new shells, and set the Ollama `keep_alive` value used to keep models warm between requests.

For a production build: `npm run build`. Run the e2e smoke suite with `npm run e2e`.

---

## Output Capture

The engine can use previous command output to make smarter suggestions (e.g. run `git branch`, then `git checkout` suggests an actual branch name).

- **PTY capture** — set `LAC_PTY_CAPTURE_MODE=allowlist` to wrap only selected commands, or `LAC_PTY_CAPTURE_MODE=blocklist` to wrap most external commands while excluding tools you do not want to run through the PTY helper. In the daemon UI, enter one exact command name or one `/regex/` per line in the allow-list or block-list. Plain lines match the executable name, while regex lines match the full command text, which is useful when the lightweight PTY shell can interfere with complex interactive CLI tools.
- **Auto capture** — set `LAC_AUTO_CAPTURE_ENABLED=1` for safe non-interactive commands (may affect color output)
- **Explicit** — `lac-capture <command>` or `lac-capture-pty <command>` for one-off capture

The control app Daemon page can persist the PTY capture mode plus newline-separated allow-list and block-list rules to `runtime.env` so new shells pick them up automatically.

---

## Inspect Logged Data

```bash
./bin/autocomplete-client inspect summary
./bin/autocomplete-client inspect top-commands --limit 15
./bin/autocomplete-client inspect recent-feedback --limit 20
```

---

## Tests

```bash
make test               # Go unit tests
make smoke-shell        # Zsh integration smoke test
make bench-models       # Model benchmark suite
cd apps/console && npm run typecheck && npm run lint && npm run build && npm run e2e
```

Compare multiple models:

```bash
./bin/model-bench -models qwen2.5-coder:7b,gemma3:12b-it-qat,mistral-small
```

---

## Current Status

This is an actively developed personal project. The engine, control app, and shell integration are functional and used daily. The biggest remaining areas are quality tuning, richer eval loops, and shell UX hardening.
