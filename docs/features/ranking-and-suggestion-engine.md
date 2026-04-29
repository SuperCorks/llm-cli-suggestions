# Ranking And Suggestion Engine

The ranking engine lives in `internal/engine`.

## Inputs

The engine uses these inputs when choosing a suggestion:

- current buffer
- an empty current buffer when the last recorded command gives enough context for a high-confidence correction or follow-up
- recent commands from the current session
- output-bearing context from the last three recorded commands when available
- historical prefix matches from SQLite
- cwd, repo root, and branch
- acceptance and rejection feedback
- previous command context
- selected recent output snippets from the current session
- last exit code
- an optional static system-prompt prefix configured through runtime settings
- optional local model output
- an optional daemon setting that enables model-output validation retries, on by default

## Current Strategy

1. Normalize the current buffer.
2. Resolve recent commands, last command context, and recent output-bearing commands from local history when available.
3. If the current session is new or sparse, fill those gaps from the latest commands seen in the same working directory.
4. Run the independent local lookups in parallel where possible.
5. Gather prefix-matching history candidates when the buffer is non-empty.
6. Gather targeted retrieval candidates for paths, git branches, and project tasks.
   Path retrieval treats bare `.` and `..` tokens as directory prefixes, so inputs like `cd ..` resolve against the current or parent directory the same way `cd ./` or `cd ../` do.
7. If the buffer is empty, only allow the model path when there is a recorded last command to ground the suggestion.
8. In classic `history+model`, trust history immediately when one candidate is clearly dominant.
9. In `history-then-model`, `history-then-fast-then-model`, `fast-then-model`, and the internal rerank stage used by those modes, still ask the model even when history is trusted or intentionally skipped so later stages can replace the visible ghost text with a better-ranked result.
10. When the model path is used and retries are enabled, validate each model response before it can enter ranking. Failed attempts append a compact `previous_invalid_suggestions` block to the next prompt and retry up to 3 total model attempts for that stage request.
11. Validation currently checks that the model output is non-empty, extends the current buffer, begins with the current buffer, avoids obvious formatting prefixes like numbered lists or quoted wrappers, does not repeat a previously rejected attempt in the same retry chain, and passes a best-effort executable lookup for simple external commands.
12. Score all candidates using history, feedback, recency, last-command context, and selected recent output context.
13. Persist every model retry attempt plus the final visible suggestion for each completed stage request.

## Empty Buffer Behavior

When the current buffer is empty, the engine does not open history-prefix matching or token retrieval against the whole command corpus. Instead, it only permits a model-backed suggestion when there is a non-empty `last_command` context available. The prompt appends one compact empty-buffer instruction at the end of the snapshot, in place of a blank `current_buffer` block, telling the model to prefer a correction of the last command or the most likely immediate follow-up command, and otherwise return an empty response.

## Prompt Shape

For live suggestions, the prompt now uses explicit divider sections for core instructions, terminal context, past commands, retrieved matches, available project commands, and the current buffer. It still collapses `last_command`, recent command lists, recent command context, and recent output context into one deduplicated `recent_context` block inside the past-commands section so the prompt keeps useful recent output while reducing repeated command names.

Project command retrieval is now source-aware end to end. Instead of flattening everything into bare task names, the engine preserves whether a candidate came from `package.json`, `Makefile`, or `justfile`, renders runnable commands like `npm run build`, `make test`, or `just dev`, and groups the broader project-command context by source in the prompt.

Model output cleaning stays intentionally conservative. Before the engine accepts a model-backed command, it strips a small set of formatting wrappers that show up in local-model responses, including case-insensitive `command:` or `buffer:` labels, surrounding single backticks, and single-command fenced code blocks.

After cleaning, the retry gate can still reject a model candidate if it fails the current buffer, duplicate-attempt, invalid-start, or best-effort executable checks. Failed attempts are carried forward in the next prompt as a short invalid-suggestion summary so the model can self-correct without changing the shell contract.

## Candidate Sources

- `history`
- `model`
- `history+model`

## Strategy Modes

- `history-only`
- `history+model`
- `history-then-model`
- `history-then-fast-then-model`
- `fast-then-model`
- `model-only`

The progressive modes are shell-orchestrated. The helper can fire a history-only stage first, then one or two rerank requests that force model participation with either the configured fast-stage model or the primary daemon model. In the dual-model flows, the helper now starts the fast-stage model first and only starts the slow-stage model afterward so the two Ollama requests do not contend with each other. In `fast-then-model`, the helper skips history entirely and stages a fast `model-only` request before the primary model. Each later stage reuses the same ranking engine and only replaces the ghost text if it produces a stronger winner for the same buffer generation.

## Performance Notes

The engine is still primarily bounded by local model latency when the model path is used, but it now overlaps independent SQLite reads and local retrieval work so history-heavy or retrieval-heavy requests spend less time in engine-side orchestration before ranking.

## Why It Matters

This is the feature that makes the app feel personalized instead of acting like a generic command-completion tool.
