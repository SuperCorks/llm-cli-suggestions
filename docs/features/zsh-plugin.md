# Zsh Plugin

The `zsh` plugin in `zsh/llm-cli-suggestions.zsh` is the live terminal integration layer.

## Responsibilities

- source-time configuration
- per-shell async state setup
- async suggestion scheduling through a detached helper process
- ghost-text rendering
- suggestion highlighting
- `Tab` acceptance
- fallback to native completion
- command lifecycle hooks through `preexec` and `precmd`
- optional allowlisted PTY-backed output capture for selected commands
- opt-in automatic bounded output capture for safe non-interactive commands
- explicit bounded output capture with `lac-capture`
- explicit PTY-backed bounded output capture with `lac-capture-pty`

## Key Behaviors

- suggestions only render when the cursor is at the end of the buffer
- stale async requests are discarded
- completed async work wakes ZLE through a per-session notify pipe and `zle -F` widget handler
- accepted suggestions are logged as feedback
- accepting a suggestion immediately re-runs the async suggestion flow against the accepted buffer so chained completions can appear without extra typing
- rejected suggestions are logged when the executed command differs from the active suggestion
- commands named in `LAC_PTY_CAPTURE_ALLOWLIST` are wrapped in a lightweight `script(1)` PTY session when they run on a real terminal
- PTY-captured commands preserve terminal-style behavior better than direct shell redirection, but their combined transcript is stored as a bounded excerpt rather than as separate stdout/stderr streams
- long captured excerpts keep both the beginning and the end of the output with a small middle truncation marker
- bounded stdout and stderr can be captured automatically for simple commands when `LAC_AUTO_CAPTURE_ENABLED=1`, and are still skipped for interactive, backgrounded, piped, or redirected commands
- automatic capture stays disabled by default because shell-level redirection changes TTY detection and can suppress command color in the live terminal
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
- `LAC_PTY_CAPTURE_ALLOWLIST`
- `LAC_AUTO_CAPTURE_ENABLED`
- `LAC_SNAPSHOT_PATH`

## Why It Exists

Keeping the editor integration in shell code allows the UX to feel native while delegating heavier work to the daemon.
