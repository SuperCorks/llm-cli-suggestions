# Offline Eval And Usage Data

## Why This Matters

The fastest way to improve suggestion quality is to stop guessing and start measuring against real behavior. The app already logs commands, suggestions, and feedback locally, which gives us the raw material for a real offline evaluation loop.

## What To Build

- a small export path from SQLite into an eval dataset
- a way to label whether the executed command matched the suggestion
- a repeatable scorecard for quality over time
- per-repo or per-workflow slices so we can see where the system is strong or weak

## Good V1 Scope

- define a reproducible dataset format
- generate examples from accepted and rejected suggestions
- measure top-1 exact-match rate
- measure prefix-validity rate
- compare history-only, model-only, and blended ranking

## Why It Comes Early

Without an eval loop, prompt changes and ranking tweaks are hard to trust. With one, we can make deliberate improvements instead of chasing anecdotes.

## Open Questions

- how aggressively should near-matches count as wins
- whether to keep the eval set session-specific or merge across repos
- how to handle commands that were manually edited after acceptance
