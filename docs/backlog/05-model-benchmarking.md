# Model Benchmarking

## Why This Matters

Model choice affects both latency and usefulness. Because the app is local-only, the best model depends heavily on the user’s machine and workflow.

## Current State

The repo already includes `cmd/model-bench`, which benchmarks models across a fixed set of command-completion cases and reports latency, valid-prefix rate, and acceptable-suggestion rate.

## What To Improve

- add more benchmark cases from real usage
- separate cold-start and warm-run results
- compare prompt variants
- track quality over time when ranking changes
- refresh the fixed benchmark suite from the most recent few days of local usage instead of relying only on synthetic hand-written cases

## Good Next Step

- treat `qwen2.5-coder:7b` as the current baseline
- compare one smaller model and one stronger model
- save raw benchmark results so they can be compared later
- after a few fresh days of usage, extract the most representative accepted and rejected flows and turn them into a curated benchmark fixture set
- keep the benchmark list small enough to run quickly, but broad enough to cover git, package managers, infra tooling, and repo-specific commands you actually use

## Candidate Models To Keep In View

- `gemma3:4b-it-qat` as a lighter latency-focused option
- `qwen2.5-coder:7b` as the current default baseline
- `mistral-small` as the stronger quality-oriented comparison point

## Open Questions

- whether one global default model is enough
- whether model choice should vary by laptop capability
- how much latency budget is acceptable for live typing
- how many days of recent usage are enough before refreshing the benchmark fixture set
- how to balance representative real usage with a stable benchmark suite that does not churn too often
