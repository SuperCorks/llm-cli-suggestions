# Ranking And Suggestion Engine

The ranking engine lives in `internal/engine`.

## Inputs

The engine uses these inputs when choosing a suggestion:

- current buffer
- recent commands from the current session
- historical prefix matches from SQLite
- cwd, repo root, and branch
- acceptance and rejection feedback
- previous command context
- selected recent output snippets from the current session
- last exit code
- optional local model output

## Current Strategy

1. Normalize the current buffer.
2. Fetch recent session commands.
3. Fetch the last command context and recent output-bearing commands from the same session.
4. Gather prefix-matching history candidates.
5. If history is clearly dominant, return the top history result immediately.
6. Otherwise, ask the local model for one completion.
7. Score all candidates using history, feedback, recency, last-command context, and selected recent output context.
8. Persist the winning suggestion.

## Candidate Sources

- `history`
- `model`
- `history+model`

## Why It Matters

This is the feature that makes the app feel personalized instead of acting like a generic command-completion tool.
