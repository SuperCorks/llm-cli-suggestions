package api

type SuggestRequest struct {
	SessionID      string   `json:"session_id"`
	Buffer         string   `json:"buffer"`
	CWD            string   `json:"cwd"`
	RepoRoot       string   `json:"repo_root"`
	Branch         string   `json:"branch"`
	LastExitCode   int      `json:"last_exit_code"`
	RecentCommands []string `json:"recent_commands,omitempty"`
	Strategy       string   `json:"strategy,omitempty"`
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

type InspectRequest struct {
	SessionID      string   `json:"session_id"`
	Buffer         string   `json:"buffer"`
	CWD            string   `json:"cwd"`
	RepoRoot       string   `json:"repo_root"`
	Branch         string   `json:"branch"`
	LastExitCode   *int     `json:"last_exit_code,omitempty"`
	RecentCommands []string `json:"recent_commands,omitempty"`
	Limit          int      `json:"limit,omitempty"`
	ModelName      string   `json:"model_name,omitempty"`
	ModelBaseURL   string   `json:"model_base_url,omitempty"`
	Strategy       string   `json:"strategy,omitempty"`
}

type InspectCandidateBreakdown struct {
	History       int `json:"history"`
	Retrieval     int `json:"retrieval"`
	Model         int `json:"model"`
	Feedback      int `json:"feedback"`
	RecentUsage   int `json:"recent_usage"`
	LastContext   int `json:"last_context"`
	OutputContext int `json:"output_context"`
	Total         int `json:"total"`
}

type InspectCandidate struct {
	Command       string                    `json:"command"`
	Source        string                    `json:"source"`
	Score         int                       `json:"score"`
	LatencyMS     int64                     `json:"latency_ms"`
	HistoryScore  int                       `json:"history_score"`
	AcceptedCount int                       `json:"accepted_count"`
	RejectedCount int                       `json:"rejected_count"`
	Breakdown     InspectCandidateBreakdown `json:"breakdown"`
}

type InspectRetrievedContext struct {
	CurrentToken       string   `json:"current_token"`
	HistoryMatches     []string `json:"history_matches"`
	PathMatches        []string `json:"path_matches"`
	GitBranchMatches   []string `json:"git_branch_matches"`
	ProjectTasks       []string `json:"project_tasks"`
	ProjectTaskMatches []string `json:"project_task_matches"`
}

type InspectRecentOutputContext struct {
	Command       string `json:"command"`
	ExitCode      int    `json:"exit_code"`
	StdoutExcerpt string `json:"stdout_excerpt"`
	StderrExcerpt string `json:"stderr_excerpt"`
	FinishedAtMS  int64  `json:"finished_at_ms"`
	Score         int    `json:"score"`
}

type InspectCommandContext struct {
	Command       string `json:"command"`
	ExitCode      int    `json:"exit_code"`
	StdoutExcerpt string `json:"stdout_excerpt"`
	StderrExcerpt string `json:"stderr_excerpt"`
	CWD           string `json:"cwd"`
	RepoRoot      string `json:"repo_root"`
	Branch        string `json:"branch"`
	FinishedAtMS  int64  `json:"finished_at_ms"`
}

type InspectResponse struct {
	ModelName                 string                       `json:"model_name"`
	RequestModelName          string                       `json:"request_model_name,omitempty"`
	HistoryTrusted            bool                         `json:"history_trusted"`
	ModelError                string                       `json:"model_error,omitempty"`
	Prompt                    string                       `json:"prompt"`
	RawModelOutput            string                       `json:"raw_model_output"`
	CleanedModelOutput        string                       `json:"cleaned_model_output"`
	ModelTotalDurationMS      int64                        `json:"model_total_duration_ms,omitempty"`
	ModelLoadDurationMS       int64                        `json:"model_load_duration_ms,omitempty"`
	ModelPromptEvalDurationMS int64                        `json:"model_prompt_eval_duration_ms,omitempty"`
	ModelEvalDurationMS       int64                        `json:"model_eval_duration_ms,omitempty"`
	ModelPromptEvalCount      int64                        `json:"model_prompt_eval_count,omitempty"`
	ModelEvalCount            int64                        `json:"model_eval_count,omitempty"`
	RecentCommands            []string                     `json:"recent_commands"`
	LastCommand               string                       `json:"last_command"`
	LastStdoutExcerpt         string                       `json:"last_stdout_excerpt"`
	LastStderrExcerpt         string                       `json:"last_stderr_excerpt"`
	LastCommandContext        []InspectCommandContext      `json:"last_command_context"`
	RecentOutputContext       []InspectRecentOutputContext `json:"recent_output_context"`
	RetrievedContext          InspectRetrievedContext      `json:"retrieved_context"`
	Winner                    *InspectCandidate            `json:"winner"`
	Candidates                []InspectCandidate           `json:"candidates"`
}
