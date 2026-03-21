# Session Logging And Feedback

One of the most important features of the app is that it already records local usage data that can improve future ranking.

## What Gets Logged

### Sessions

Each shell session gets a local session id.

### Commands

Executed commands record:

- command text
- cwd
- repo root
- branch
- exit code
- duration
- start and finish timestamps
- bounded stdout and stderr excerpts

### Suggestions

Each generated suggestion records:

- input buffer
- final suggestion
- source
- latency
- model name
- context metadata

### Feedback Events

Each feedback record tracks:

- accepted or rejected
- original buffer
- suggestion text
- accepted command
- actual command

## Why It Matters

This data supports:

- better local heuristics
- future retrieval and reranking
- offline evaluation
- eventual supervised fine-tuning experiments

Fine-tuning is not part of `v1`, but the data model is already pointing in that direction.
