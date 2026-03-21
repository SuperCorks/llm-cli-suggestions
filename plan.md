# Local LLM Terminal Autosuggestion Plan

## Problem Summary

Build a macOS-first terminal autosuggestion engine that works with the existing local terminal and `zsh` setup. It should feel like a smarter replacement for current autosuggestions, refresh while typing, stay fully local, and improve over time based on actual usage.

## V1 Goal

Ship a fast, local-only autosuggestion system that:

- runs in `zsh`
- refreshes suggestions as the user types
- uses recent shell context to predict the next command
- stores learning signals locally in SQLite
- calls a local model through Ollama or a similar localhost model server

## Proposed V1 Architecture

### Shell Integration

- A `zsh` plugin owns the inline ghost-text UX.
- It reads the current input buffer while typing.
- It hooks into `preexec` and `precmd` to capture accepted commands and prompt-cycle metadata.
- It supports accepting the suggestion with `Tab`, while falling back to normal completion when no suggestion is available.

### Local Inference Service

- A Go daemon owns inference, ranking, caching, and persistence.
- It exposes a lightweight local API or Unix socket for the `zsh` plugin.
- It queries a local model runner such as Ollama.
- It returns suggestions asynchronously so the shell stays responsive.
- It is started explicitly from the user's `fancy` shell setup rather than auto-starting for every shell.

### Memory And Learning

- SQLite stores commands, session metadata, accepts, rejects, edits-after-accept, and model latency.
- Retrieval uses recent commands, cwd, git repo, branch, exit code, and prompt prefix.
- Learning in `v1` is retrieval and reranking, not fine-tuning.

### Output Context

- `v1` will not try to capture every byte from a full PTY session.
- `v1` should capture reliable command context first:
  - current buffer
  - executed commands
  - cwd
  - repo root and branch when available
  - exit status
  - command duration
  - selected recent shell history
- If feasible without turning this into a terminal emulator, `v1` may also capture bounded stdout/stderr for non-interactive commands.

## Acceptance Criteria

- Suggestions appear inline and refresh while typing.
- Suggestion latency is usually under 1 second on the target machine.
- All inference and storage stay local.
- The system works in macOS `zsh` without requiring a custom terminal app.
- The daemon can use at least one local model backend successfully.
- Accepted and rejected suggestions are stored and influence later ranking.
- Existing shell completion still works after integration.

## Out Of Scope For V1

- Building a full terminal emulator.
- Capturing rich context from every interactive TUI program.
- Cloud inference, remote telemetry, or privacy redaction systems.
- Fine-tuning or model training pipelines.
- Cross-shell or cross-platform support beyond macOS `zsh`.

## Step-By-Step Plan

### Phase 1: Baseline Cleanup

1. Remove `fzf` autocomplete wiring from `zshrc`.
2. Keep native Zsh completion intact.
3. Confirm fancy mode still loads only the features we want to preserve.

### Phase 2: Define V1 Interfaces

1. Define the shell plugin contract:
   - request suggestion
   - cancel stale request
   - render ghost text
   - accept suggestion
   - notify daemon of accept or reject
2. Define the daemon API:
   - `suggest`
   - `feedback`
   - `record-command`
   - `health`
3. Define the SQLite schema for:
   - sessions
   - commands
   - suggestions
   - feedback events
   - model runs

### Phase 3: Build Minimal Working Loop

1. Implement a Go daemon with a local SQLite database.
2. Add a simple local model adapter for Ollama.
3. Build a `zsh` plugin that sends the current buffer and receives a suggestion.
4. Render inline ghost text and support one accept keybinding.
5. Record accepted commands and feedback events.

### Phase 4: Add Useful Context

1. Include recent command history in the prompt.
2. Include cwd, repo root, branch, and last exit code.
3. Add lightweight prompt prefix matching and cache recent suggestions.
4. Add cancellation and debouncing so typing stays responsive.

### Phase 5: Improve Ranking

1. Blend three candidate sources:
   - recent exact-prefix history
   - context-matched historical commands
   - model-generated command suggestions
2. Rank candidates using local heuristics first.
3. Use acceptance and edit behavior to improve future ranking.

### Phase 6: Validate V1

1. Test in normal mode and fancy mode.
2. Benchmark latency on real usage flows.
3. Verify fallback behavior when the daemon or model is unavailable.
4. Document installation, startup, and disable paths.

## Initial Technical Decisions

- `zsh` plugin for UI
- Go for daemon and orchestration
- SQLite for local memory
- Ollama as the first model host, with a backend boundary so faster local runtimes can be swapped in later
- macOS only
- local-only inference and storage
- `Tab` accepts an available suggestion and otherwise preserves native completion behavior

## Model Shortlist For V1 Evaluation

These are the first three local models to benchmark:

1. `gemma3:4b-it-qat`
   - Fast baseline candidate
   - Good fit for low-latency local iteration
2. `qwen2.5-coder:7b`
   - Strong coding and shell-adjacent prior
   - Good candidate for command prediction quality
3. `mistral-small`
   - Quality-heavy option if local hardware can support it comfortably

## Model Evaluation Criteria

- time to first token
- full suggestion latency
- command usefulness
- tendency to hallucinate invalid commands
- ability to use shell context well
- stability under short, partial prefixes

## Future Learning Roadmap

### Logging Goals

The system should be designed so it can grow into a learning-based assistant over time. Even if `v1` only uses retrieval and reranking, we should log enough structured data to support future offline training and evaluation.

### Signals To Capture

- current prompt buffer
- rendered suggestion
- suggestion source and rank
- whether the suggestion was accepted
- whether it was partially accepted and then edited
- the command that was actually executed
- cwd, repo root, branch, exit code, timestamp, and session id
- command duration
- bounded command output where available
- model name, latency, and prompt template version

### Future Uses Of The Log Data

- better heuristic ranking
- retrieval over similar past command situations
- offline evaluation sets
- personalized rerankers
- future supervised fine-tuning datasets

### Fine-Tuning Direction

- Fine-tuning is explicitly out of scope for `v1`.
- We should still preserve enough structured feedback to make it possible later.
- Any future fine-tuning effort should start only after we have a clean local dataset and a repeatable offline eval loop.

## Repo Impact

- `~/.zshrc`
- `~/.fzf.zsh`
- `plan.md`
- `cmd/...`
- `internal/...`
- `zsh/...`

## Risks And Considerations

- A plain `zsh` plugin does not automatically provide full shell output history.
- If output capture becomes essential, we may need a deeper integration layer later.
- Local model latency may vary widely by model size and machine memory.
- Aggressive suggestion refresh can create stale-response flicker unless requests are canceled correctly.
- Suggestion quality may be worse than history-based approaches unless retrieval is strong.

## Testing Notes

- Verify typing responsiveness with and without the daemon running.
- Measure latency across short prefixes and context-heavy prompts.
- Confirm accepted suggestions execute exactly as rendered.
- Confirm rejected suggestions do not pollute ranking too heavily.
- Test inside and outside git repos.

## Rollback Notes

- Keep shell integration shallow and easy to disable from `.zshrc`.
- Keep the daemon optional so the shell still works without it.
- Preserve native Zsh completion as the fallback path.
