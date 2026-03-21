package api

type SuggestRequest struct {
	SessionID      string   `json:"session_id"`
	Buffer         string   `json:"buffer"`
	CWD            string   `json:"cwd"`
	RepoRoot       string   `json:"repo_root"`
	Branch         string   `json:"branch"`
	LastExitCode   int      `json:"last_exit_code"`
	RecentCommands []string `json:"recent_commands,omitempty"`
}

type SuggestResponse struct {
	SuggestionID int64  `json:"suggestion_id"`
	Suggestion   string `json:"suggestion"`
	Source       string `json:"source"`
}

type FeedbackRequest struct {
	SuggestionID    int64  `json:"suggestion_id"`
	SessionID       string `json:"session_id"`
	EventType       string `json:"event_type"`
	Buffer          string `json:"buffer"`
	Suggestion      string `json:"suggestion"`
	AcceptedCommand string `json:"accepted_command"`
	ActualCommand   string `json:"actual_command"`
}

type RecordCommandRequest struct {
	SessionID     string `json:"session_id"`
	Command       string `json:"command"`
	CWD           string `json:"cwd"`
	RepoRoot      string `json:"repo_root"`
	Branch        string `json:"branch"`
	ExitCode      int    `json:"exit_code"`
	DurationMS    int64  `json:"duration_ms"`
	StartedAtMS   int64  `json:"started_at_ms"`
	FinishedAtMS  int64  `json:"finished_at_ms"`
	StdoutExcerpt string `json:"stdout_excerpt"`
	StderrExcerpt string `json:"stderr_excerpt"`
}

type HealthResponse struct {
	Status    string `json:"status"`
	ModelName string `json:"model_name"`
	Socket    string `json:"socket"`
}
