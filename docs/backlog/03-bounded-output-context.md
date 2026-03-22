# Bounded Output Context

## Why This Matters

Some of the most useful next-command predictions depend on the output of the previous command, especially after errors, search commands, or status checks.

## Current State

The app can capture bounded output through lightweight PTY wrappers for commands named in `LAC_PTY_CAPTURE_ALLOWLIST`, can still use the older opt-in `LAC_AUTO_CAPTURE_ENABLED=1` path for safe non-interactive commands, keeps `lac-capture` and `lac-capture-pty` as explicit fallbacks, and can feed a small selected set of recent session output snippets into prompting and ranking.

## What To Improve

- harden PTY allowlist capture around more shell edge cases
- decide how broad the default PTY allowlist should be, if any
- improve relevance selection so noisy session output is ignored even more aggressively
- measure how much recent-output context actually improves acceptance rates
- decide whether session-only output context should eventually expand to repo-scoped reuse

## Good Next Step

- keep capture size small
- keep selection focused on only a few relevant snippets
- avoid full transcript logging
- compare session-only output context against repo-scoped reuse with real data

## Why Not A Full PTY Interposer

The current PTY support is intentionally narrow: it wraps only explicitly allowlisted commands and stores bounded excerpts. A full PTY or terminal-interposer solution would still be much heavier. It would add complexity to shell integration, make debugging harder, and expand the amount of data stored locally.

## Open Questions

- which commands should be excluded from capture
- whether session-only output context is enough for the best suggestions
- how much output meaningfully improves next-command quality
