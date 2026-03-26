package benchmark

import "github.com/SuperCorks/llm-cli-suggestions/internal/api"

type Track string

const (
	TrackStatic Track = "static"
	TrackReplay Track = "replay"
	TrackEval   Track = "eval"
	TrackRaw    Track = "raw"
)

type Surface string

const (
	SurfaceEndToEnd Surface = "end_to_end"
	SurfaceRawModel Surface = "raw_model"
)

type TimingProtocol string

const (
	TimingProtocolColdOnly TimingProtocol = "cold_only"
	TimingProtocolHotOnly  TimingProtocol = "hot_only"
	TimingProtocolMixed    TimingProtocol = "mixed"
	TimingProtocolFull     TimingProtocol = "full"
)

type TimingPhase string

const (
	TimingPhaseCold  TimingPhase = "cold"
	TimingPhaseHot   TimingPhase = "hot"
	TimingPhaseMixed TimingPhase = "mixed"
)

type StartState string

const (
	StartStateCold          StartState = "cold"
	StartStateHot           StartState = "hot"
	StartStateUnknown       StartState = "unknown"
	StartStateNotApplicable StartState = "not_applicable"
)

type LabelKind string

const (
	LabelKindPositive LabelKind = "positive"
	LabelKindNegative LabelKind = "negative"
)

type EvalConfidence string

const (
	EvalConfidenceStrong EvalConfidence = "strong"
	EvalConfidenceMedium EvalConfidence = "medium"
)

type EvalOutcome string

const (
	EvalOutcomeAccepted          EvalOutcome = "accepted"
	EvalOutcomeExecutedUnchanged EvalOutcome = "executed_unchanged"
	EvalOutcomeExecutedEdited    EvalOutcome = "executed_edited"
	EvalOutcomeRejected          EvalOutcome = "rejected"
	EvalOutcomeReviewedGood      EvalOutcome = "reviewed_good"
	EvalOutcomeReviewedBad       EvalOutcome = "reviewed_bad"
)

type Environment struct {
	Hostname        string `json:"hostname"`
	OS              string `json:"os"`
	Arch            string `json:"arch"`
	GoVersion       string `json:"go_version"`
	ModelBaseURL    string `json:"model_base_url"`
	ModelKeepAlive  string `json:"model_keep_alive"`
	ActiveModelName string `json:"active_model_name"`
	DBPath          string `json:"db_path"`
}

type ReplaySource struct {
	SuggestionID int64  `json:"suggestion_id,omitempty"`
	EventType    string `json:"event_type,omitempty"`
	QualityLabel string `json:"quality_label,omitempty"`
}

type Case struct {
	ID           string             `json:"id"`
	Name         string             `json:"name"`
	Category     string             `json:"category"`
	Tags         []string           `json:"tags,omitempty"`
	Notes        string             `json:"notes,omitempty"`
	LabelKind    LabelKind          `json:"label_kind"`
	Request      api.SuggestRequest `json:"request"`
	Expected     string             `json:"expected,omitempty"`
	Alternatives []string           `json:"alternatives,omitempty"`
	Negative     string             `json:"negative,omitempty"`
	Origin       string             `json:"origin,omitempty"`
	ReplaySource ReplaySource       `json:"replay_source,omitempty"`
}

type EvalExample struct {
	ID                    string             `json:"id"`
	SuggestionID          int64              `json:"suggestion_id"`
	CreatedAtMS           int64              `json:"created_at_ms"`
	LabelKind             LabelKind          `json:"label_kind"`
	Outcome               EvalOutcome        `json:"outcome"`
	Confidence            EvalConfidence     `json:"confidence"`
	CommandFamily         string             `json:"command_family"`
	RepoRoot              string             `json:"repo_root,omitempty"`
	RepoName              string             `json:"repo_name,omitempty"`
	SuggestionSource      string             `json:"suggestion_source,omitempty"`
	ModelName             string             `json:"model_name,omitempty"`
	Request               api.SuggestRequest `json:"request"`
	PromptText            string             `json:"prompt_text,omitempty"`
	StructuredContextJSON string             `json:"structured_context_json,omitempty"`
	SuggestedCommand      string             `json:"suggested_command,omitempty"`
	ExpectedCommand       string             `json:"expected_command,omitempty"`
	NegativeCommand       string             `json:"negative_command,omitempty"`
	AcceptedCommand       string             `json:"accepted_command,omitempty"`
	ActualCommand         string             `json:"actual_command,omitempty"`
	ReplaySource          ReplaySource       `json:"replay_source,omitempty"`
}

type EvalDataset struct {
	SchemaVersion int           `json:"schema_version"`
	Examples      []EvalExample `json:"examples"`
}

type CandidatePreview struct {
	Command string `json:"command"`
	Source  string `json:"source"`
	Score   int    `json:"score"`
}

type RunMetadata struct {
	Track          Track          `json:"track"`
	Surface        Surface        `json:"surface"`
	SuiteName      string         `json:"suite_name"`
	Strategy       string         `json:"strategy"`
	TimingProtocol TimingProtocol `json:"timing_protocol"`
	RepeatCount    int            `json:"repeat_count"`
	Models         []string       `json:"models"`
	TimeoutMS      int64          `json:"timeout_ms"`
	FiltersJSON    string         `json:"filters_json,omitempty"`
	DatasetSize    int            `json:"dataset_size"`
	Environment    Environment    `json:"environment"`
}

type AttemptResult struct {
	Model                      string             `json:"model"`
	Track                      Track              `json:"track"`
	Surface                    Surface            `json:"surface"`
	SuiteName                  string             `json:"suite_name"`
	Strategy                   string             `json:"strategy"`
	TimingProtocol             TimingProtocol     `json:"timing_protocol"`
	TimingPhase                TimingPhase        `json:"timing_phase"`
	StartState                 StartState         `json:"start_state"`
	CaseID                     string             `json:"case_id"`
	CaseName                   string             `json:"case_name"`
	Category                   string             `json:"category"`
	Tags                       []string           `json:"tags,omitempty"`
	LabelKind                  LabelKind          `json:"label_kind"`
	Run                        int                `json:"run"`
	Request                    api.SuggestRequest `json:"request"`
	ExpectedCommand            string             `json:"expected_command,omitempty"`
	ExpectedAlternatives       []string           `json:"expected_alternatives,omitempty"`
	NegativeTarget             string             `json:"negative_target,omitempty"`
	WinnerCommand              string             `json:"winner_command,omitempty"`
	WinnerSource               string             `json:"winner_source,omitempty"`
	TopCandidates              []CandidatePreview `json:"top_candidates,omitempty"`
	RawModelOutput             string             `json:"raw_model_output,omitempty"`
	CleanedModelOutput         string             `json:"cleaned_model_output,omitempty"`
	ExactMatch                 bool               `json:"exact_match"`
	AlternativeMatch           bool               `json:"alternative_match"`
	NegativeAvoided            bool               `json:"negative_avoided"`
	ValidPrefix                bool               `json:"valid_prefix"`
	CandidateHitAt3            bool               `json:"candidate_hit_at_3"`
	CharsSavedRatio            float64            `json:"chars_saved_ratio"`
	CommandEditDistance        int                `json:"command_edit_distance"`
	RequestLatencyMS           int64              `json:"request_latency_ms"`
	ModelTotalDurationMS       int64              `json:"model_total_duration_ms"`
	ModelLoadDurationMS        int64              `json:"model_load_duration_ms"`
	ModelPromptEvalDurationMS  int64              `json:"model_prompt_eval_duration_ms"`
	ModelEvalDurationMS        int64              `json:"model_eval_duration_ms"`
	ModelPromptEvalCount       int64              `json:"model_prompt_eval_count"`
	ModelEvalCount             int64              `json:"model_eval_count"`
	DecodeTokensPerSecond      float64            `json:"decode_tokens_per_second"`
	NonModelOverheadDurationMS int64              `json:"non_model_overhead_duration_ms"`
	ModelError                 string             `json:"model_error,omitempty"`
	Error                      string             `json:"error,omitempty"`
	ReplaySource               ReplaySource       `json:"replay_source,omitempty"`
}

type LatencyStats struct {
	Count  int     `json:"count"`
	Mean   float64 `json:"mean"`
	Median float64 `json:"median"`
	P90    float64 `json:"p90"`
	P95    float64 `json:"p95"`
	Max    float64 `json:"max"`
}

type QualitySummary struct {
	PositiveCaseCount    int     `json:"positive_case_count"`
	NegativeCaseCount    int     `json:"negative_case_count"`
	PositiveExactHitRate float64 `json:"positive_exact_hit_rate"`
	NegativeAvoidRate    float64 `json:"negative_avoid_rate"`
	ValidWinnerRate      float64 `json:"valid_winner_rate"`
	CandidateRecallAt3   float64 `json:"candidate_recall_at_3"`
	CharsSavedRatio      float64 `json:"chars_saved_ratio"`
}

type StartStateSummary struct {
	Key     StartState   `json:"key"`
	Count   int          `json:"count"`
	Share   float64      `json:"share"`
	Latency LatencyStats `json:"latency"`
}

type StageSummary struct {
	Label                   string  `json:"label"`
	Count                   int     `json:"count"`
	AvgRequestLatencyMS     float64 `json:"avg_request_latency_ms"`
	AvgModelTotalDurationMS float64 `json:"avg_model_total_duration_ms"`
	AvgLoadDurationMS       float64 `json:"avg_load_duration_ms"`
	AvgPromptEvalDurationMS float64 `json:"avg_prompt_eval_duration_ms"`
	AvgEvalDurationMS       float64 `json:"avg_eval_duration_ms"`
	AvgNonModelOverheadMS   float64 `json:"avg_non_model_overhead_ms"`
	DecodeTokensPerSecond   float64 `json:"decode_tokens_per_second"`
}

type BudgetPassRate struct {
	BudgetMS float64 `json:"budget_ms"`
	Rate     float64 `json:"rate"`
}

type BucketSummary struct {
	Key     string         `json:"key"`
	Label   string         `json:"label"`
	Count   int            `json:"count"`
	Share   float64        `json:"share"`
	Quality QualitySummary `json:"quality"`
	Latency LatencyStats   `json:"latency"`
}

type AggregateSummary struct {
	Count             int                 `json:"count"`
	Quality           QualitySummary      `json:"quality"`
	Latency           LatencyStats        `json:"latency"`
	StartStates       []StartStateSummary `json:"start_states"`
	ColdPenaltyMS     float64             `json:"cold_penalty_ms"`
	Stages            []StageSummary      `json:"stages"`
	BudgetPassRates   []BudgetPassRate    `json:"budget_pass_rates"`
	RepoBreakdown     []BucketSummary     `json:"repo_breakdown"`
	CategoryBreakdown []BucketSummary     `json:"category_breakdown"`
	SourceBreakdown   []BucketSummary     `json:"source_breakdown"`
}

type ModelSummary struct {
	Model   string           `json:"model"`
	Overall AggregateSummary `json:"overall"`
	Cold    AggregateSummary `json:"cold"`
	Hot     AggregateSummary `json:"hot"`
}

type Progress struct {
	Completed    int    `json:"completed"`
	Total        int    `json:"total"`
	Percent      int    `json:"percent"`
	Status       string `json:"status"`
	CurrentModel string `json:"current_model"`
	CurrentCase  string `json:"current_case"`
	CurrentRun   int    `json:"current_run"`
	CurrentPhase string `json:"current_phase"`
}

type RunSummary struct {
	Progress          Progress         `json:"progress"`
	Track             Track            `json:"track"`
	Surface           Surface          `json:"surface"`
	SuiteName         string           `json:"suite_name"`
	Strategy          string           `json:"strategy"`
	TimingProtocol    TimingProtocol   `json:"timing_protocol"`
	DatasetSize       int              `json:"dataset_size"`
	PositiveCaseCount int              `json:"positive_case_count"`
	NegativeCaseCount int              `json:"negative_case_count"`
	Overall           AggregateSummary `json:"overall"`
	Models            []ModelSummary   `json:"models"`
}

type Artifact struct {
	SchemaVersion int             `json:"schema_version"`
	Run           RunMetadata     `json:"run"`
	Summary       RunSummary      `json:"summary"`
	Cases         []Case          `json:"cases"`
	Attempts      []AttemptResult `json:"attempts"`
}
