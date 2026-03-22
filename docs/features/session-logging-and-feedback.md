# Session Logging And Feedback

One of the most important features of the app is that it already records local usage data that can improve future ranking.

## What Gets Logged

### Sessions

Each shell session gets a local session id.

### Commands

Executed commands record:

- command text
- cwd
- repo root
- branch
- exit code
- duration
- start and finish timestamps
- bounded stdout and stderr excerpts

For commands that you place in `LAC_PTY_CAPTURE_ALLOWLIST`, the shell can capture bounded terminal output through a lightweight PTY wrapper while preserving terminal-style behavior more faithfully than plain shell redirection. Because PTY output is a combined terminal transcript, successful PTY captures are currently stored in the stdout excerpt field and failing PTY captures are stored in the stderr excerpt field. Long excerpts are trimmed by keeping the beginning and end with a middle truncation marker so stack traces and footer summaries survive more often. The older `LAC_AUTO_CAPTURE_ENABLED=1` path still exists for safe non-interactive commands, but it remains opt-in because shell-level redirection changes TTY detection and can suppress live terminal color. `lac-capture` and `lac-capture-pty` remain available as explicit wrappers when you want to force bounded capture for a specific command.

### Suggestions

Each generated suggestion records:

- input buffer
- final suggestion
- source
- latency
- model name
- context metadata
- the exact prompt snapshot used for the decision
- structured context JSON including request fields, recent commands, last-command context, selected recent output snippets, and retrieved values such as local project tasks

### Feedback Events

Each feedback record tracks:

- accepted or rejected
- original buffer
- suggestion text
- accepted command
- actual command

## Why It Matters

This data supports:

- better local heuristics
- future retrieval and reranking
- offline evaluation
- eventual supervised fine-tuning experiments

Fine-tuning is not part of `v1`, but the data model is already pointing in that direction.
