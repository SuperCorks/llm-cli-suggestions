# cli-auto-complete

Local LLM-powered terminal autosuggestions for macOS `zsh`.

## Current Status

This repo currently contains the first implementation slice:

- a Go daemon listening on a local Unix socket
- SQLite-backed logging for commands, suggestions, and feedback
- an Ollama model adapter
- a small client binary for shell integration
- a `zsh` plugin that fetches suggestions asynchronously and accepts them with `Tab`

## Build

```bash
make tidy
make build
```

This creates:

- `bin/autocomplete-daemon`
- `bin/autocomplete-client`
- `bin/model-bench`

## Start The Daemon

```bash
./bin/autocomplete-daemon
```

By default it uses:

- socket: `~/Library/Application Support/cli-auto-complete/daemon.sock`
- db: `~/Library/Application Support/cli-auto-complete/autocomplete.sqlite`
- model: `qwen2.5-coder:7b`
- model base url: `http://127.0.0.1:11434`

You can override those with environment variables:

- `LAC_SOCKET_PATH`
- `LAC_DB_PATH`
- `LAC_MODEL_NAME`
- `LAC_MODEL_BASE_URL`
- `LAC_SUGGEST_TIMEOUT_MS`

## Zsh Integration

Clone the repo and source the plugin from your shell setup after the binaries are available:

```bash
git clone https://github.com/SuperCorks/cli-auto-complete.git
cd cli-auto-complete
make build
source "$PWD/zsh/cli-auto-complete.zsh"
```

If needed, point the plugin at the built binaries explicitly:

```bash
export LAC_CLIENT_BIN="$PWD/bin/autocomplete-client"
export LAC_DAEMON_BIN="$PWD/bin/autocomplete-daemon"
```

Start the daemon from the shell with:

```bash
lac-start-daemon
```

## Current Behavior

- `Tab` accepts a suggestion if one is visible.
- If no suggestion is visible, `Tab` falls back to normal completion.
- Suggestions are requested asynchronously with a short debounce and stale responses are discarded.
- The plugin records executed commands, accepted suggestions, and rejected suggestions.
- Suggestions are ranked from history, context, feedback, and local model output.
- `lac-capture <command ...>` can be used for bounded stdout/stderr capture on non-interactive commands.

## Inspect Logged Data

Use the client to inspect the local SQLite data:

```bash
./bin/autocomplete-client inspect summary
./bin/autocomplete-client inspect top-commands --limit 15
./bin/autocomplete-client inspect recent-feedback --limit 20
```

## Benchmark And Smoke Tests

Run the automated checks with:

```bash
make test
make smoke-shell
make bench-models
```

`make bench-models` uses `llama3.2:latest` by default. To benchmark a different installed model:

```bash
./bin/model-bench -models qwen2.5-coder:7b
```

To compare multiple installed models:

```bash
./bin/model-bench -models llama3.2:latest,qwen2.5-coder:7b,mistral-small
```

## Notes

- This is an early scaffold, not a finished autosuggestion engine.
- Output capture is still intentionally limited in `v1` and currently works best through `lac-capture`.
- The next major improvement area is deeper shell-side UX polish rather than basic plumbing.
