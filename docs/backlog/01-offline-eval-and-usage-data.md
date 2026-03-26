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

## Good Near-Term Step

- let a few recent days of local usage accumulate in SQLite after a clean reset
- export accepted, rejected, and manually-corrected suggestion flows into a candidate eval dataset
- bucket the data by repo, command family, and failure mode so the first benchmark refresh is not dominated by one workflow
- keep the raw local history private and derive a small curated fixture set for repeatable repo benchmarks

## Recommended Sequence

This work should be treated as the foundation for both ranking improvements and any later model training.

1. turn recent accepted, rejected, and manually reviewed suggestions into a stable eval dataset
2. score exact-match, prefix-validity, and negative-avoidance by repo and command family
3. make that scorecard easy to run from the benchmark flow
4. use those results to drive the next ranking pass instead of tuning heuristics by feel

Only after that loop is stable should the project move into model-training work.

## Path Toward Fine Tuning

If the long-term goal is to fine tune a local model on collected usage, this backlog item should expand into a staged data pipeline:

1. export high-confidence training examples from `suggestions`, `feedback_events`, `commands`, and manual `suggestion_reviews`
2. define target labels such as accepted unchanged, accepted then edited, rejected, and manually marked good or bad
3. freeze train, dev, and test splits by time and repo so future experiments are comparable
4. first use the dataset to improve ranking or train a learned reranker
5. only then run a narrow supervised fine-tuning experiment on the cleanest command-completion examples
6. keep the fine-tuned model only if it beats the heuristic and replay-benchmark baseline on the same eval harness

The key idea is that the eval dataset and the future training dataset should come from the same cleaned and labeled source, but the eval loop must come first.

## Why It Comes Early

Without an eval loop, prompt changes and ranking tweaks are hard to trust. With one, we can make deliberate improvements instead of chasing anecdotes.

## Open Questions

- how aggressively should near-matches count as wins
- whether to keep the eval set session-specific or merge across repos
- how to handle commands that were manually edited after acceptance
- when an accepted-but-edited command should count as a ranking win, a training positive, or both
- whether the first learned component should be a reranker instead of a direct generative fine tune
