# Zsh Plugin

The `zsh` plugin in `zsh/cli-auto-complete.zsh` is the live terminal integration layer.

## Responsibilities

- source-time configuration
- per-shell async state setup
- async suggestion scheduling through a detached helper process
- ghost-text rendering
- suggestion highlighting
- `Tab` acceptance
- fallback to native completion
- command lifecycle hooks through `preexec` and `precmd`
- optional bounded output capture with `lac-capture`

## Key Behaviors

- suggestions only render when the cursor is at the end of the buffer
- stale async requests are discarded
- completed async work wakes ZLE through a per-session notify pipe and `zle -F` widget handler
- accepted suggestions are logged as feedback
- rejected suggestions are logged when the executed command differs from the active suggestion
- ghost text is styled through `region_highlight`
- optional redraw snapshots can be written to `LAC_SNAPSHOT_PATH` for integration testing

## Important Settings

- `LAC_CLIENT_BIN`
- `LAC_DAEMON_BIN`
- `LAC_ASYNC_HELPER_BIN`
- `LAC_SOCKET_PATH`
- `LAC_DB_PATH`
- `LAC_MODEL_NAME`
- `LAC_DEBOUNCE_SECONDS`
- `LAC_HIGHLIGHT_STYLE`
- `LAC_CAPTURE_BYTES`
- `LAC_SNAPSHOT_PATH`

## Why It Exists

Keeping the editor integration in shell code allows the UX to feel native while delegating heavier work to the daemon.
