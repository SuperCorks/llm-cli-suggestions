# Backlog

This directory breaks future work into focused topics instead of keeping everything in one long roadmap.

Each file describes:

- why the work matters
- what a good first implementation looks like
- the main risks or open questions

Current backlog topics:

- `01-offline-eval-and-usage-data.md`
- `02-ranking-and-retrieval.md`
- `03-bounded-output-context.md`
- `04-inspection-and-observability.md`
- `05-model-benchmarking.md`
- `06-shell-ux-hardening.md`

## Current Planning Direction

The current recommended path is:

1. build a stable offline eval dataset from local usage
2. make that dataset part of repeatable benchmark runs and scorecards
3. use the results to improve retrieval and ranking first
4. reuse the same cleaned, labeled pipeline later for reranking or fine-tuning experiments

This keeps model-training work grounded in the same evaluation harness used for heuristic changes, so future fine-tuning can be judged against a trusted local baseline instead of anecdotes.

## To refine
- Review ranking system
- Check if more than 1 engine running
