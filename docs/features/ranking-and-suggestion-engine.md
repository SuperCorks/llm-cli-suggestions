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

## Current Strategy

1. Normalize the current buffer.
2. Resolve recent commands, last command context, and recent output-bearing commands from local history when available.
3. If the current session is new or sparse, fill those gaps from the latest commands seen in the same working directory.
4. Run the independent local lookups in parallel where possible.
5. Gather prefix-matching history candidates when the buffer is non-empty.
6. Gather targeted retrieval candidates for paths, git branches, and project tasks.
7. If the buffer is empty, only allow the model path when there is a recorded last command to ground the suggestion.
8. If history is clearly dominant, return the top history result immediately.
9. Otherwise, ask the local model for one completion.
10. Score all candidates using history, feedback, recency, last-command context, and selected recent output context.
11. Persist the winning suggestion.

## Empty Buffer Behavior

When the current buffer is empty, the engine does not open history-prefix matching or token retrieval against the whole command corpus. Instead, it only permits a model-backed suggestion when there is a non-empty `last_command` context available. The prompt explicitly tells the model that the buffer is empty right now and asks for either the most likely correction of the last command or the most likely immediate follow-up command, with an empty response preferred when there is no clear next step.

## Candidate Sources

- `history`
- `model`
- `history+model`

## Performance Notes

The engine is still primarily bounded by local model latency when the model path is used, but it now overlaps independent SQLite reads and local retrieval work so history-heavy or retrieval-heavy requests spend less time in engine-side orchestration before ranking.

## Why It Matters

This is the feature that makes the app feel personalized instead of acting like a generic command-completion tool.
