package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/SuperCorks/llm-cli-suggestions/internal/api"
	"github.com/SuperCorks/llm-cli-suggestions/internal/config"
	"github.com/SuperCorks/llm-cli-suggestions/internal/db"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		exitWithError(err)
	}

	if len(os.Args) < 2 {
		exitWithError(fmt.Errorf("expected subcommand"))
	}

	switch os.Args[1] {
	case "health":
		runHealth(cfg.SocketPath, os.Args[2:])
	case "suggest":
		runSuggest(cfg.SocketPath, cfg.SuggestTimeout, os.Args[2:])
	case "feedback":
		runFeedback(cfg.SocketPath, os.Args[2:])
	case "record-command":
		runRecordCommand(cfg.SocketPath, os.Args[2:])
	case "inspect":
		runInspect(cfg.DBPath, os.Args[2:])
	default:
		exitWithError(fmt.Errorf("unknown subcommand: %s", os.Args[1]))
	}
}

func runHealth(defaultSocket string, args []string) {
	flags := flag.NewFlagSet("health", flag.ExitOnError)
	socket := flags.String("socket", defaultSocket, "unix socket path")
	_ = flags.Parse(args)

	client := newSocketClient(*socket, 2500*time.Millisecond)
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "http://unix/health", nil)
	if err != nil {
		exitWithError(err)
	}

	response, err := client.Do(request)
	if err != nil {
		exitWithError(err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		exitWithError(fmt.Errorf("health check failed: %s", response.Status))
	}

	var payload api.HealthResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		exitWithError(err)
	}
	fmt.Println(payload.Status)
}

func runSuggest(defaultSocket string, suggestTimeout time.Duration, args []string) {
	flags := flag.NewFlagSet("suggest", flag.ExitOnError)
	socket := flags.String("socket", defaultSocket, "unix socket path")
	sessionID := flags.String("session", "", "session id")
	buffer := flags.String("buffer", "", "current buffer")
	cwd := flags.String("cwd", "", "current working directory")
	repoRoot := flags.String("repo-root", "", "repo root")
	branch := flags.String("branch", "", "git branch")
	lastExitCode := flags.Int("last-exit", 0, "last exit code")
	strategy := flags.String("strategy", "", "suggestion strategy override")
	modelName := flags.String("model", "", "model name override")
	modelBaseURL := flags.String("model-url", "", "model base URL override")
	_ = flags.Parse(args)

	client := newSocketClient(*socket, clientTimeoutForSuggest(suggestTimeout))
	payload := api.SuggestRequest{
		SessionID:    *sessionID,
		Buffer:       *buffer,
		CWD:          *cwd,
		RepoRoot:     *repoRoot,
		Branch:       *branch,
		LastExitCode: *lastExitCode,
		Strategy:     *strategy,
		ModelName:    *modelName,
		ModelBaseURL: *modelBaseURL,
	}

	var response api.SuggestResponse
	if err := doJSON(client, http.MethodPost, "http://unix/suggest", payload, &response); err != nil {
		exitWithError(err)
	}

	fmt.Printf("%d\t%s\t%s\n", response.SuggestionID, sanitizeTSV(response.Suggestion), sanitizeTSV(response.Source))
}

func runFeedback(defaultSocket string, args []string) {
	flags := flag.NewFlagSet("feedback", flag.ExitOnError)
	socket := flags.String("socket", defaultSocket, "unix socket path")
	sessionID := flags.String("session", "", "session id")
	suggestionID := flags.Int64("suggestion-id", 0, "suggestion id")
	eventType := flags.String("event", "", "event type")
	buffer := flags.String("buffer", "", "buffer")
	suggestion := flags.String("suggestion", "", "suggestion")
	acceptedCommand := flags.String("accepted-command", "", "accepted command")
	actualCommand := flags.String("actual-command", "", "actual command")
	_ = flags.Parse(args)

	client := newSocketClient(*socket, 2500*time.Millisecond)
	payload := api.FeedbackRequest{
		SuggestionID:    *suggestionID,
		SessionID:       *sessionID,
		EventType:       *eventType,
		Buffer:          *buffer,
		Suggestion:      *suggestion,
		AcceptedCommand: *acceptedCommand,
		ActualCommand:   *actualCommand,
	}

	if err := doJSON(client, http.MethodPost, "http://unix/feedback", payload, nil); err != nil {
		exitWithError(err)
	}
}

func runRecordCommand(defaultSocket string, args []string) {
	flags := flag.NewFlagSet("record-command", flag.ExitOnError)
	socket := flags.String("socket", defaultSocket, "unix socket path")
	sessionID := flags.String("session", "", "session id")
	command := flags.String("command", "", "executed command")
	cwd := flags.String("cwd", "", "cwd")
	repoRoot := flags.String("repo-root", "", "repo root")
	branch := flags.String("branch", "", "branch")
	exitCode := flags.Int("exit-code", 0, "exit code")
	durationMS := flags.Int64("duration-ms", 0, "duration in milliseconds")
	startedAtMS := flags.Int64("started-at-ms", 0, "start time in unix milliseconds")
	finishedAtMS := flags.Int64("finished-at-ms", 0, "finish time in unix milliseconds")
	stdoutExcerpt := flags.String("stdout", "", "stdout excerpt")
	stderrExcerpt := flags.String("stderr", "", "stderr excerpt")
	_ = flags.Parse(args)

	client := newSocketClient(*socket, 2500*time.Millisecond)
	payload := api.RecordCommandRequest{
		SessionID:     *sessionID,
		Command:       *command,
		CWD:           *cwd,
		RepoRoot:      *repoRoot,
		Branch:        *branch,
		ExitCode:      *exitCode,
		DurationMS:    *durationMS,
		StartedAtMS:   *startedAtMS,
		FinishedAtMS:  *finishedAtMS,
		StdoutExcerpt: *stdoutExcerpt,
		StderrExcerpt: *stderrExcerpt,
	}

	if err := doJSON(client, http.MethodPost, "http://unix/command", payload, nil); err != nil {
		exitWithError(err)
	}
}

func runInspect(defaultDBPath string, args []string) {
	if len(args) == 0 {
		exitWithError(fmt.Errorf("expected inspect subcommand"))
	}

	switch args[0] {
	case "summary":
		runInspectSummary(defaultDBPath, args[1:])
	case "top-commands":
		runInspectTopCommands(defaultDBPath, args[1:])
	case "recent-feedback":
		runInspectRecentFeedback(defaultDBPath, args[1:])
	default:
		exitWithError(fmt.Errorf("unknown inspect subcommand: %s", args[0]))
	}
}

func runInspectSummary(defaultDBPath string, args []string) {
	flags := flag.NewFlagSet("inspect summary", flag.ExitOnError)
	dbPath := flags.String("db", defaultDBPath, "sqlite database path")
	_ = flags.Parse(args)

	store, err := db.NewStore(*dbPath)
	if err != nil {
		exitWithError(err)
	}
	defer store.Close()

	summary, err := store.InspectSummary(context.Background())
	if err != nil {
		exitWithError(err)
	}

	fmt.Printf("sessions\t%d\n", summary.SessionCount)
	fmt.Printf("commands\t%d\n", summary.CommandCount)
	fmt.Printf("suggestions\t%d\n", summary.SuggestionCount)
	fmt.Printf("accepted\t%d\n", summary.AcceptedCount)
	fmt.Printf("edited\t%d\n", summary.EditedCount)
	fmt.Printf("buffered\t%d\n", summary.BufferedCount)
	fmt.Printf("rejected\t%d\n", summary.RejectedCount)
	fmt.Printf("avg_model_latency_ms\t%.1f\n", summary.AverageModelLatency)
}

func runInspectTopCommands(defaultDBPath string, args []string) {
	flags := flag.NewFlagSet("inspect top-commands", flag.ExitOnError)
	dbPath := flags.String("db", defaultDBPath, "sqlite database path")
	limit := flags.Int("limit", 10, "max rows")
	_ = flags.Parse(args)

	store, err := db.NewStore(*dbPath)
	if err != nil {
		exitWithError(err)
	}
	defer store.Close()

	commands, err := store.GetTopCommands(context.Background(), *limit)
	if err != nil {
		exitWithError(err)
	}

	for _, command := range commands {
		fmt.Printf("%d\t%s\n", command.Count, sanitizeTSV(command.Command))
	}
}

func runInspectRecentFeedback(defaultDBPath string, args []string) {
	flags := flag.NewFlagSet("inspect recent-feedback", flag.ExitOnError)
	dbPath := flags.String("db", defaultDBPath, "sqlite database path")
	limit := flags.Int("limit", 10, "max rows")
	_ = flags.Parse(args)

	store, err := db.NewStore(*dbPath)
	if err != nil {
		exitWithError(err)
	}
	defer store.Close()

	rows, err := store.GetRecentFeedback(context.Background(), *limit)
	if err != nil {
		exitWithError(err)
	}

	for _, row := range rows {
		fmt.Printf(
			"%d\t%s\t%s\t%s\t%s\n",
			row.CreatedAtMS,
			sanitizeTSV(row.EventType),
			sanitizeTSV(row.Suggestion),
			sanitizeTSV(row.AcceptedCommand),
			sanitizeTSV(row.ActualCommand),
		)
	}
}

func newSocketClient(socketPath string, timeout time.Duration) *http.Client {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(ctx, "unix", socketPath)
		},
	}

	if timeout <= 0 {
		timeout = 2500 * time.Millisecond
	}

	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
	}
}

func clientTimeoutForSuggest(suggestTimeout time.Duration) time.Duration {
	if suggestTimeout <= 0 {
		return 2500 * time.Millisecond
	}

	const buffer = 500 * time.Millisecond
	return suggestTimeout + buffer
}

func doJSON(client *http.Client, method, url string, payload any, target any) error {
	var body bytes.Buffer
	if payload != nil {
		if err := json.NewEncoder(&body).Encode(payload); err != nil {
			return fmt.Errorf("encode payload: %w", err)
		}
	}

	request, err := http.NewRequestWithContext(context.Background(), method, url, &body)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode >= 300 {
		var failure map[string]string
		_ = json.NewDecoder(response.Body).Decode(&failure)
		if message := failure["error"]; message != "" {
			return errors.New(message)
		}
		return fmt.Errorf("request failed with status %s", response.Status)
	}

	if target == nil {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

func sanitizeTSV(value string) string {
	value = strings.ReplaceAll(value, "\t", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	return strings.TrimSpace(value)
}

func exitWithError(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
