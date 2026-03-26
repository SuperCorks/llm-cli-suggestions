# Daemon API

The Go daemon is the local service that coordinates suggestions, logging, and storage.

## Transport

- protocol: HTTP
- address type: Unix domain socket
- default socket path: `~/Library/Application Support/llm-cli-suggestions/daemon.sock`

## Routes

### `GET /health`

Returns daemon health plus model and socket information.

The daemon runtime itself is configured from `runtime.env` values such as model name, Ollama base URL, suggestion strategy, timeout, and Ollama `keep_alive`.

The runtime control paths that start or restart the daemon intentionally keep the service singleton-scoped on the local machine. Repointing the shell or control app at another state dir changes which socket and runtime files the daemon uses, but it does not leave multiple `autocomplete-daemon` processes running in parallel.

### `POST /suggest`

Accepts a suggestion request containing:

- session id
- current buffer
- cwd
- repo root
- branch
- last exit code

Returns:

- suggestion id
- suggestion text
- suggestion source

### `POST /feedback`

Records execution-aware suggestion feedback, including buffer acceptance, unchanged execution, edited execution, or rejection, plus the accepted and actual command text when available.

### `POST /command`

Records executed command details including:

- command text
- cwd
- repo metadata
- exit code
- duration
- bounded stdout excerpt
- bounded stderr excerpt

### `POST /inspect`

Accepts a ranking-inspection request containing:

- session id
- current buffer
- cwd
- repo root
- branch
- last exit code
- optional recent commands
- optional model override

Returns:

- winning candidate
- full candidate list
- per-candidate score breakdown
- prompt text
- raw model output
- cleaned model output
- last-command output excerpts
- selected recent session output snippets used for prompting and ranking

## Why It Exists

The daemon isolates runtime state, model calls, and storage access from the shell. That keeps the shell integration lighter and makes the system easier to test.
