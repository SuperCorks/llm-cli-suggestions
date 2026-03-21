# Ranking And Retrieval

## Why This Matters

The system already combines history and model output, but the biggest quality gains are likely to come from a stronger local ranking layer rather than a more expensive model.

## What To Improve

- stronger repo-aware historical retrieval
- cwd-sensitive ranking
- better weighting for accepted and rejected suggestions
- more deliberate use of last command and exit code
- duplicate suppression between history and model candidates

## Good V1.1 Scope

- keep the current history-first architecture
- add clearer scoring rules and weights
- inspect candidate lists before the final choice
- tune against a local offline eval set

## Longer-Term Direction

Once enough local usage data exists, this could evolve into:

- a personalized reranker
- similarity search over prior command situations
- feature-driven ranking based on repo, branch, previous command, and result

## Risks

- overfitting too hard to one repo or one short history window
- making ranking too opaque to debug
- over-penalizing suggestions after a small number of rejections
