# Model Benchmarking

## Why This Matters

Model choice affects both latency and usefulness. Because the app is local-only, the best model depends heavily on the user’s machine and workflow.

## Current State

The repo now includes a richer benchmark system with:

- `static` curated suites
- `replay` live-DB evals built from accepted, rejected, and manually labeled suggestions
- `raw` prompt/model-only diagnostics
- cold-only, hot-only, mixed, and full timing protocols
- JSON artifacts plus persisted SQLite summaries and per-attempt rows

## What To Improve

- add more curated cases from mined replay suggestions
- compare prompt variants directly in saved benchmark jobs
- track quality over time when ranking or retrieval changes
- add stronger tests for benchmark job persistence and replay sampling
- decide whether replay runs should support saved named filter presets in the console

## Good Next Step

- treat `qwen3-coder:latest` as the current local baseline
- compare one smaller model and one stronger model
- keep mining replay suggestions into proposed static fixtures, then promote only the representative cases manually
- keep the curated suite small enough to run quickly, but broad enough to cover git, navigation, package managers, infra tooling, empty-buffer follow-ups, and repo-specific commands you actually use

## Candidate Models To Keep In View

- `gemma3:4b-it-qat` as a lighter latency-focused option
- `qwen3-coder:latest` as the current default baseline
- `mistral-small` as the stronger quality-oriented comparison point

## Open Questions

- whether one global default model is enough
- whether model choice should vary by laptop capability
- how much latency budget is acceptable for live typing
- how many days of recent usage are enough before refreshing the benchmark fixture set
- how to balance representative real usage with a stable benchmark suite that does not churn too often
