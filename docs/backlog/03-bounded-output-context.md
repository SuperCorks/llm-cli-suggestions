# Bounded Output Context

## Why This Matters

Some of the most useful next-command predictions depend on the output of the previous command, especially after errors, search commands, or status checks.

## Current State

The app already supports bounded output capture through `lac-capture`, and the suggestion prompt can include the last stdout and stderr excerpts when they exist.

## What To Improve

- make output capture easier to use in normal workflows
- capture safe, bounded excerpts for non-interactive commands
- incorporate output context more consistently into ranking and prompt generation

## Good Next Step

- keep capture size small
- focus on the last command only
- avoid full transcript logging
- prefer stderr-heavy failure cases first

## Why Not PTY Capture Yet

A full PTY or terminal-interposer solution would be much heavier. It would add complexity to shell integration, make debugging harder, and expand the amount of data stored locally. Bounded last-command context is the simpler next move.

## Open Questions

- which commands should be excluded from capture
- whether output capture should be opt-in, opt-out, or heuristic
- how much output meaningfully improves next-command quality
