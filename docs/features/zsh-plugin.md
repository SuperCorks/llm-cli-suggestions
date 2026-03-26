# Zsh Plugin

The `zsh` plugin in `zsh/llm-cli-suggestions.zsh` is the live terminal integration layer.

## Responsibilities

- source-time configuration
- per-shell async state setup
- async suggestion scheduling through a detached helper process
- ghost-text rendering
- suggestion highlighting
- configurable `Tab` or Right Arrow acceptance
- fallback to native completion
- command lifecycle hooks through `preexec` and `precmd`
- optional PTY-backed output capture for external commands, configurable as either an allowlist or a blocklist
- opt-in automatic bounded output capture for safe non-interactive commands
- explicit bounded output capture with `lac-capture`
- explicit PTY-backed bounded output capture with `lac-capture-pty`

## Key Behaviors

- suggestions only render when the cursor is at the end of the buffer
- suggestions can still render on an empty prompt when the cursor is at the end of the buffer and the daemon returns a full-command suggestion
- stale async requests are discarded
- completed async work wakes ZLE through a per-session notify pipe and `zle -F` widget handler
- accepted suggestions are first logged as `accepted_buffer`
- accepted suggestions are then resolved at `preexec` as either `executed_unchanged` or `executed_edited`
- accepting a suggestion immediately re-runs the async suggestion flow against the accepted buffer so chained completions can appear without extra typing
- rejected suggestions are logged when the executed command differs from the active suggestion
- when `LAC_PTY_CAPTURE_MODE=allowlist`, the plugin can match one exact command name or one `/regex/` per line from `LAC_PTY_CAPTURE_ALLOWLIST`; plain lines match the executable name while regex lines match the full command text before deciding whether to run through the lightweight `script(1)` PTY session
- when `LAC_PTY_CAPTURE_MODE=blocklist`, the plugin wraps most external commands except lines in `LAC_PTY_CAPTURE_BLOCKLIST`, with the same exact-name and `/regex/` matching rules
- PTY wrappers are installed lazily just before command execution from the line editor, with `preexec` retained as a fallback for non-editor execution paths, so shells do not pay a startup cost for wrapping the whole command table up front
- PTY-captured commands preserve terminal-style behavior better than direct shell redirection, but their combined transcript is stored as a bounded excerpt rather than as separate stdout/stderr streams
- long captured excerpts keep the first 400 bytes and the last 800 bytes of the output with a small middle truncation marker
- bounded stdout and stderr can be captured automatically for simple commands when `LAC_AUTO_CAPTURE_ENABLED=1`, and are still skipped for interactive, backgrounded, piped, or stdout-redirected commands; stderr-only redirection falls back to this path so stderr stays hidden and out of captured suggestion context
- automatic capture stays disabled by default because shell-level redirection changes TTY detection and can suppress command color in the live terminal
- ghost text is styled through `region_highlight` and can append a square-bracket source badge such as `[history]` or `[ai]` without changing what the configured accept key accepts
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
- `LAC_ACCEPT_KEY`
- `LAC_CAPTURE_HEAD_BYTES`
- `LAC_CAPTURE_TAIL_BYTES`
- `LAC_PTY_CAPTURE_MODE`
- `LAC_PTY_CAPTURE_ALLOWLIST`
- `LAC_PTY_CAPTURE_BLOCKLIST`
- `LAC_AUTO_CAPTURE_ENABLED`
- `LAC_SNAPSHOT_PATH`

## Why It Exists

Keeping the editor integration in shell code allows the UX to feel native while delegating heavier work to the daemon.
