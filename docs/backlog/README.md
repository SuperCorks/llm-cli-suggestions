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

## To refine
- Use the llm to parse previous outputs like copilot/codex --prompt into the next command, even if it's not in the history
- Toggle between blocklist, allowlist and all for the TTY console + extensive testing with interactive apps
- Wakeup model when we run `fancy` to accelerate cold starts
- 