# Ranking And Suggestion Engine

The ranking engine lives in `internal/engine`.

## Inputs

The engine uses these inputs when choosing a suggestion:

- current buffer
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
5. Gather prefix-matching history candidates.
6. Gather targeted retrieval candidates for paths, git branches, and project tasks.
7. If history is clearly dominant, return the top history result immediately.
8. Otherwise, ask the local model for one completion.
9. Score all candidates using history, feedback, recency, last-command context, and selected recent output context.
10. Persist the winning suggestion.

## Candidate Sources

- `history`
- `model`
- `history+model`

## Performance Notes

The engine is still primarily bounded by local model latency when the model path is used, but it now overlaps independent SQLite reads and local retrieval work so history-heavy or retrieval-heavy requests spend less time in engine-side orchestration before ranking.

## Why It Matters

This is the feature that makes the app feel personalized instead of acting like a generic command-completion tool.
