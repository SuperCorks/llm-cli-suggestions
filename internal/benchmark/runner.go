package benchmark

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/SuperCorks/llm-cli-suggestions/internal/api"
	"github.com/SuperCorks/llm-cli-suggestions/internal/db"
	"github.com/SuperCorks/llm-cli-suggestions/internal/engine"
	"github.com/SuperCorks/llm-cli-suggestions/internal/model"
	"github.com/SuperCorks/llm-cli-suggestions/internal/model/ollama"
)

const (
	minimumPrewarmTimeout  = 20 * time.Second
	hotResidentLoadFloorMS = int64(250)
)

type RunConfig struct {
	Track           Track
	Surface         Surface
	SuiteName       string
	Strategy        string
	TimingProtocol  TimingProtocol
	Models          []string
	RepeatCount     int
	Timeout         time.Duration
	FailFast        bool
	DBPath          string
	ModelBaseURL    string
	ModelKeepAlive  string
	ActiveModelName string
	SystemPrompt    string
	ReplayLimit     int
	FiltersJSON     string
}

func (c RunConfig) TimeoutMS() int64 {
	return c.Timeout.Milliseconds()
}

type ProgressWriter func(Progress)

func Run(ctx context.Context, cfg RunConfig, progress ProgressWriter) (Artifact, error) {
	benchmarkCases, err := resolveCases(ctx, cfg)
	if err != nil {
		return Artifact{}, err
	}

	environment, err := resolveEnvironment(cfg)
	if err != nil {
		return Artifact{}, err
	}

	phases := timingPhases(cfg.TimingProtocol)
	totalAttempts := len(cfg.Models) * len(benchmarkCases) * max(1, cfg.RepeatCount) * len(phases)
	notifyProgress(progress, Progress{
		Completed: 0,
		Total:     totalAttempts,
		Percent:   0,
		Status:    "running",
	})

	store, err := db.NewStore(cfg.DBPath)
	if err != nil {
		return Artifact{}, fmt.Errorf("open benchmark store: %w", err)
	}
	defer store.Close()

	attempts := make([]AttemptResult, 0, totalAttempts)
	completed := 0
	var runErr error

	for _, modelName := range cfg.Models {
		for _, phase := range phases {
			if err := prewarmIfNeeded(ctx, cfg, modelName, phase); err != nil {
				runErr = err
				goto done
			}

			for _, benchmarkCase := range benchmarkCases {
				for run := 1; run <= max(1, cfg.RepeatCount); run++ {
					attempt, attemptErr := runAttempt(ctx, cfg, store, modelName, phase, benchmarkCase, run)
					if attemptErr != nil && attempt.Error == "" {
						attempt.Error = attemptErr.Error()
					}
					attempts = append(attempts, attempt)
					completed++
					notifyProgress(progress, Progress{
						Completed:    completed,
						Total:        totalAttempts,
						Percent:      percent(completed, totalAttempts),
						Status:       "running",
						CurrentModel: modelName,
						CurrentCase:  benchmarkCase.Name,
						CurrentRun:   run,
						CurrentPhase: string(phase),
					})
					if attemptErr != nil && cfg.FailFast {
						runErr = attemptErr
						goto done
					}
					if attemptErr != nil && runErr == nil {
						runErr = attemptErr
					}
				}
			}
		}
	}

done:
	summary := summarizeAttempts(cfg, benchmarkCases, attempts, Progress{
		Completed:    completed,
		Total:        totalAttempts,
		Percent:      percent(completed, totalAttempts),
		Status:       statusForRunError(runErr),
		CurrentModel: lastAttemptModel(attempts),
		CurrentCase:  lastAttemptCase(attempts),
		CurrentRun:   lastAttemptRun(attempts),
		CurrentPhase: string(lastAttemptPhase(attempts)),
	})

	artifact := Artifact{
		SchemaVersion: 1,
		Run: RunMetadata{
			Track:          cfg.Track,
			Surface:        cfg.Surface,
			SuiteName:      cfg.SuiteName,
			Strategy:       cfg.Strategy,
			TimingProtocol: cfg.TimingProtocol,
			RepeatCount:    max(1, cfg.RepeatCount),
			Models:         append([]string(nil), cfg.Models...),
			TimeoutMS:      cfg.TimeoutMS(),
			FiltersJSON:    cfg.FiltersJSON,
			DatasetSize:    len(benchmarkCases),
			Environment:    environment,
		},
		Summary:  summary,
		Cases:    benchmarkCases,
		Attempts: attempts,
	}
	return artifact, runErr
}

func resolveCases(ctx context.Context, cfg RunConfig) ([]Case, error) {
	switch cfg.Track {
	case TrackReplay:
		store, err := db.NewStore(cfg.DBPath)
		if err != nil {
			return nil, fmt.Errorf("open replay store: %w", err)
		}
		defer store.Close()
		return LoadReplayCases(ctx, store, cfg.ReplayLimit)
	case TrackRaw, TrackStatic:
		if cfg.SuiteName == "all" {
			coreCases, err := LoadStaticSuite("core")
			if err != nil {
				return nil, err
			}
			extendedCases, err := LoadStaticSuite("extended")
			if err != nil {
				return nil, err
			}
			return append(coreCases, extendedCases...), nil
		}
		return LoadStaticSuite(cfg.SuiteName)
	default:
		return nil, fmt.Errorf("unsupported track %q", cfg.Track)
	}
}

func resolveEnvironment(cfg RunConfig) (Environment, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return Environment{}, fmt.Errorf("resolve hostname: %w", err)
	}
	return Environment{
		Hostname:        hostname,
		OS:              runtime.GOOS,
		Arch:            runtime.GOARCH,
		GoVersion:       runtime.Version(),
		ModelBaseURL:    cfg.ModelBaseURL,
		ModelKeepAlive:  cfg.ModelKeepAlive,
		ActiveModelName: cfg.ActiveModelName,
		DBPath:          cfg.DBPath,
	}, nil
}

func timingPhases(protocol TimingProtocol) []TimingPhase {
	switch protocol {
	case TimingProtocolColdOnly:
		return []TimingPhase{TimingPhaseCold}
	case TimingProtocolHotOnly:
		return []TimingPhase{TimingPhaseHot}
	case TimingProtocolFull:
		return []TimingPhase{TimingPhaseCold, TimingPhaseHot}
	default:
		return []TimingPhase{TimingPhaseMixed}
	}
}

func keepAliveForPhase(cfg RunConfig, phase TimingPhase) string {
	switch phase {
	case TimingPhaseCold:
		return "0"
	case TimingPhaseHot:
		keepAlive := strings.TrimSpace(cfg.ModelKeepAlive)
		if keepAlive == "" || keepAlive == "0" {
			return "5m"
		}
		return keepAlive
	default:
		return cfg.ModelKeepAlive
	}
}

func prewarmIfNeeded(ctx context.Context, cfg RunConfig, modelName string, phase TimingPhase) error {
	if phase != TimingPhaseHot {
		return nil
	}
	client := ollama.New(cfg.ModelBaseURL, modelName, keepAliveForPhase(cfg, phase))
	prewarmCtx, cancel := context.WithTimeout(ctx, prewarmTimeout(cfg.Timeout))
	defer cancel()
	_, err := client.Suggest(prewarmCtx, "buffer: git st\ncommand:")
	if err != nil {
		return fmt.Errorf("prewarm %s: %w", modelName, err)
	}
	return nil
}

func prewarmTimeout(timeout time.Duration) time.Duration {
	if timeout < minimumPrewarmTimeout {
		return minimumPrewarmTimeout
	}
	return timeout
}

func runAttempt(
	ctx context.Context,
	cfg RunConfig,
	store *db.Store,
	modelName string,
	phase TimingPhase,
	benchmarkCase Case,
	run int,
) (AttemptResult, error) {
	switch cfg.Surface {
	case SurfaceRawModel:
		return runRawAttempt(ctx, cfg, modelName, phase, benchmarkCase, run)
	default:
		return runEndToEndAttempt(ctx, cfg, store, modelName, phase, benchmarkCase, run)
	}
}

func runRawAttempt(
	ctx context.Context,
	cfg RunConfig,
	modelName string,
	phase TimingPhase,
	benchmarkCase Case,
	run int,
) (AttemptResult, error) {
	client := ollama.New(cfg.ModelBaseURL, modelName, keepAliveForPhase(cfg, phase))
	prompt := engine.BuildPrompt(
		cfg.SystemPrompt,
		benchmarkCase.Request,
		benchmarkCase.Request.RecentCommands,
		db.CommandContext{},
		nil,
		nil,
		api.InspectRetrievedContext{},
	)
	startedAt := time.Now()
	requestCtx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()
	suggestResult, err := client.Suggest(requestCtx, prompt)
	requestLatency := time.Since(startedAt).Milliseconds()

	cleaned := engine.CleanSuggestion(benchmarkCase.Request.Buffer, suggestResult.Response)
	attempt := AttemptResult{
		Model:                     modelName,
		Track:                     cfg.Track,
		Surface:                   cfg.Surface,
		SuiteName:                 cfg.SuiteName,
		Strategy:                  cfg.Strategy,
		TimingProtocol:            cfg.TimingProtocol,
		TimingPhase:               phase,
		CaseID:                    benchmarkCase.ID,
		CaseName:                  benchmarkCase.Name,
		Category:                  benchmarkCase.Category,
		Tags:                      append([]string(nil), benchmarkCase.Tags...),
		LabelKind:                 benchmarkCase.LabelKind,
		Run:                       run,
		Request:                   benchmarkCase.Request,
		ExpectedCommand:           benchmarkCase.Expected,
		ExpectedAlternatives:      append([]string(nil), benchmarkCase.Alternatives...),
		NegativeTarget:            benchmarkCase.Negative,
		WinnerCommand:             cleaned,
		WinnerSource:              "model",
		TopCandidates:             []CandidatePreview{{Command: cleaned, Source: "model", Score: 1}},
		RawModelOutput:            suggestResult.Response,
		CleanedModelOutput:        cleaned,
		RequestLatencyMS:          requestLatency,
		ModelTotalDurationMS:      suggestResult.Metrics.TotalDurationMS,
		ModelLoadDurationMS:       suggestResult.Metrics.LoadDurationMS,
		ModelPromptEvalDurationMS: suggestResult.Metrics.PromptEvalDurationMS,
		ModelEvalDurationMS:       suggestResult.Metrics.EvalDurationMS,
		ModelPromptEvalCount:      suggestResult.Metrics.PromptEvalCount,
		ModelEvalCount:            suggestResult.Metrics.EvalCount,
		DecodeTokensPerSecond:     decodeTokensPerSecond(suggestResult.Metrics),
		NonModelOverheadDurationMS: max64(
			0,
			requestLatency-suggestResult.Metrics.TotalDurationMS,
		),
		StartState: classifyStartState(phase, true, suggestResult.Metrics),
	}
	scoreAttempt(&attempt)
	if err != nil {
		attempt.Error = err.Error()
		return attempt, err
	}
	return attempt, nil
}

func runEndToEndAttempt(
	ctx context.Context,
	cfg RunConfig,
	store *db.Store,
	modelName string,
	phase TimingPhase,
	benchmarkCase Case,
	run int,
) (AttemptResult, error) {
	client := ollama.New(cfg.ModelBaseURL, modelName, keepAliveForPhase(cfg, phase))
	runner := engine.NewWithSystemPrompt(
		store,
		client,
		modelName,
		cfg.ModelBaseURL,
		keepAliveForPhase(cfg, phase),
		cfg.Strategy,
		cfg.SystemPrompt,
		cfg.Timeout,
	)
	request := api.InspectRequest{
		SessionID:      benchmarkCase.Request.SessionID,
		Buffer:         benchmarkCase.Request.Buffer,
		CWD:            benchmarkCase.Request.CWD,
		RepoRoot:       benchmarkCase.Request.RepoRoot,
		Branch:         benchmarkCase.Request.Branch,
		LastExitCode:   intPtr(benchmarkCase.Request.LastExitCode),
		RecentCommands: append([]string(nil), benchmarkCase.Request.RecentCommands...),
		Limit:          6,
		Strategy:       cfg.Strategy,
	}
	startedAt := time.Now()
	response, err := runner.Inspect(ctx, request)
	requestLatency := time.Since(startedAt).Milliseconds()

	topCandidates := make([]CandidatePreview, 0, min(3, len(response.Candidates)))
	for index, candidate := range response.Candidates {
		if index >= 3 {
			break
		}
		topCandidates = append(topCandidates, CandidatePreview{
			Command: candidate.Command,
			Source:  candidate.Source,
			Score:   candidate.Score,
		})
	}

	metrics := inferMetricsFromResponse(response, requestLatency)
	attempt := AttemptResult{
		Model:                     modelName,
		Track:                     cfg.Track,
		Surface:                   cfg.Surface,
		SuiteName:                 cfg.SuiteName,
		Strategy:                  cfg.Strategy,
		TimingProtocol:            cfg.TimingProtocol,
		TimingPhase:               phase,
		CaseID:                    benchmarkCase.ID,
		CaseName:                  benchmarkCase.Name,
		Category:                  benchmarkCase.Category,
		Tags:                      append([]string(nil), benchmarkCase.Tags...),
		LabelKind:                 benchmarkCase.LabelKind,
		Run:                       run,
		Request:                   benchmarkCase.Request,
		ExpectedCommand:           benchmarkCase.Expected,
		ExpectedAlternatives:      append([]string(nil), benchmarkCase.Alternatives...),
		NegativeTarget:            benchmarkCase.Negative,
		WinnerCommand:             winnerCommand(response),
		WinnerSource:              winnerSource(response),
		TopCandidates:             topCandidates,
		RawModelOutput:            response.RawModelOutput,
		CleanedModelOutput:        response.CleanedModelOutput,
		RequestLatencyMS:          requestLatency,
		ModelTotalDurationMS:      metrics.TotalDurationMS,
		ModelLoadDurationMS:       metrics.LoadDurationMS,
		ModelPromptEvalDurationMS: metrics.PromptEvalDurationMS,
		ModelEvalDurationMS:       metrics.EvalDurationMS,
		ModelPromptEvalCount:      metrics.PromptEvalCount,
		ModelEvalCount:            metrics.EvalCount,
		DecodeTokensPerSecond:     decodeTokensPerSecond(metrics),
		NonModelOverheadDurationMS: max64(
			0,
			requestLatency-metrics.TotalDurationMS,
		),
		ModelError:   response.ModelError,
		StartState:   classifyEndToEndStartState(phase, response, metrics),
		ReplaySource: benchmarkCase.ReplaySource,
	}
	scoreAttempt(&attempt)
	if err != nil {
		attempt.Error = err.Error()
		return attempt, err
	}
	return attempt, nil
}

func inferMetricsFromResponse(response api.InspectResponse, requestLatency int64) model.SuggestMetrics {
	metrics := model.SuggestMetrics{
		TotalDurationMS:      response.ModelTotalDurationMS,
		LoadDurationMS:       response.ModelLoadDurationMS,
		PromptEvalDurationMS: response.ModelPromptEvalDurationMS,
		EvalDurationMS:       response.ModelEvalDurationMS,
		PromptEvalCount:      response.ModelPromptEvalCount,
		EvalCount:            response.ModelEvalCount,
	}
	if metrics.TotalDurationMS == 0 && strings.TrimSpace(response.RequestModelName) != "" {
		metrics.TotalDurationMS = requestLatency
	}
	return metrics
}

func classifyEndToEndStartState(phase TimingPhase, response api.InspectResponse, metrics model.SuggestMetrics) StartState {
	if strings.TrimSpace(response.RequestModelName) == "" {
		return StartStateNotApplicable
	}
	return classifyStartState(phase, false, metrics)
}

func classifyStartState(phase TimingPhase, rawMode bool, metrics model.SuggestMetrics) StartState {
	if metrics.TotalDurationMS == 0 &&
		metrics.LoadDurationMS == 0 &&
		metrics.PromptEvalDurationMS == 0 &&
		metrics.EvalDurationMS == 0 &&
		metrics.PromptEvalCount == 0 &&
		metrics.EvalCount == 0 {
		if rawMode {
			return StartStateUnknown
		}
		return StartStateNotApplicable
	}

	switch phase {
	case TimingPhaseCold:
		return StartStateCold
	case TimingPhaseHot:
		if isWarmResidentLoad(metrics.LoadDurationMS) {
			return StartStateHot
		}
		return StartStateCold
	default:
		if isWarmResidentLoad(metrics.LoadDurationMS) {
			return StartStateHot
		}
		return StartStateCold
	}
}

func isWarmResidentLoad(loadDurationMS int64) bool {
	return loadDurationMS >= 0 && loadDurationMS <= hotResidentLoadFloorMS
}

func decodeTokensPerSecond(metrics model.SuggestMetrics) float64 {
	if metrics.EvalCount <= 0 || metrics.EvalDurationMS <= 0 {
		return 0
	}
	return (float64(metrics.EvalCount) / float64(metrics.EvalDurationMS)) * 1000
}

func winnerCommand(response api.InspectResponse) string {
	if response.Winner == nil {
		return ""
	}
	return response.Winner.Command
}

func winnerSource(response api.InspectResponse) string {
	if response.Winner == nil {
		return ""
	}
	return response.Winner.Source
}

func scoreAttempt(attempt *AttemptResult) {
	attempt.ValidPrefix = validPrefix(attempt.Request.Buffer, attempt.WinnerCommand)
	matchedTarget := attempt.ExpectedCommand
	exactMatch, altMatch := matchesExpected(attempt.WinnerCommand, attempt.ExpectedCommand, attempt.ExpectedAlternatives)
	if !exactMatch && !altMatch && attempt.LabelKind == LabelKindNegative && strings.TrimSpace(attempt.ExpectedCommand) != "" {
		exactMatch, altMatch = matchesExpected(attempt.WinnerCommand, attempt.ExpectedCommand, attempt.ExpectedAlternatives)
	}
	if altMatch {
		for _, alt := range attempt.ExpectedAlternatives {
			if normalizeCommand(alt) == normalizeCommand(attempt.WinnerCommand) {
				matchedTarget = alt
				break
			}
		}
	}
	attempt.ExactMatch = exactMatch
	attempt.AlternativeMatch = altMatch
	attempt.CandidateHitAt3 = candidateHitAt3(attempt.TopCandidates, attempt.ExpectedCommand, attempt.ExpectedAlternatives)
	if attempt.LabelKind == LabelKindNegative {
		attempt.NegativeAvoided = normalizeCommand(attempt.WinnerCommand) != normalizeCommand(attempt.NegativeTarget)
	}
	attempt.CharsSavedRatio = computeCharsSavedRatio(
		attempt.Request.Buffer,
		matchedTarget,
		attempt.ExactMatch || attempt.AlternativeMatch,
	)
	if strings.TrimSpace(attempt.ExpectedCommand) != "" {
		attempt.CommandEditDistance = editDistance(attempt.WinnerCommand, attempt.ExpectedCommand)
	}
}

func summarizeAttempts(cfg RunConfig, cases []Case, attempts []AttemptResult, progress Progress) RunSummary {
	models := make([]string, 0, len(cfg.Models))
	models = append(models, cfg.Models...)
	sort.Strings(models)
	modelSummaries := make([]ModelSummary, 0, len(models))
	for _, modelName := range models {
		modelAttempts := filterAttempts(attempts, func(value AttemptResult) bool { return value.Model == modelName })
		modelSummaries = append(modelSummaries, ModelSummary{
			Model:   modelName,
			Overall: aggregateAttempts(modelAttempts),
			Cold:    aggregateAttempts(filterAttempts(modelAttempts, func(value AttemptResult) bool { return value.StartState == StartStateCold })),
			Hot:     aggregateAttempts(filterAttempts(modelAttempts, func(value AttemptResult) bool { return value.StartState == StartStateHot })),
		})
	}

	positiveCaseCount := 0
	negativeCaseCount := 0
	for _, benchmarkCase := range cases {
		if benchmarkCase.LabelKind == LabelKindNegative {
			negativeCaseCount++
		} else {
			positiveCaseCount++
		}
	}

	return RunSummary{
		Progress:          progress,
		Track:             cfg.Track,
		Surface:           cfg.Surface,
		SuiteName:         cfg.SuiteName,
		Strategy:          cfg.Strategy,
		TimingProtocol:    cfg.TimingProtocol,
		DatasetSize:       len(cases),
		PositiveCaseCount: positiveCaseCount,
		NegativeCaseCount: negativeCaseCount,
		Overall:           aggregateAttempts(attempts),
		Models:            modelSummaries,
	}
}

func aggregateAttempts(attempts []AttemptResult) AggregateSummary {
	latencies := make([]int64, 0, len(attempts))
	for _, attempt := range attempts {
		latencies = append(latencies, attempt.RequestLatencyMS)
	}

	startStates := summarizeStartStates(attempts)
	coldLatency := aggregateAttemptsLight(filterAttempts(attempts, func(value AttemptResult) bool { return value.StartState == StartStateCold }))
	hotLatency := aggregateAttemptsLight(filterAttempts(attempts, func(value AttemptResult) bool { return value.StartState == StartStateHot }))

	return AggregateSummary{
		Count:             len(attempts),
		Quality:           summarizeQuality(attempts),
		Latency:           summarizeLatency(latencies),
		StartStates:       startStates,
		ColdPenaltyMS:     coldLatency.Mean - hotLatency.Mean,
		Stages:            summarizeStages(attempts),
		BudgetPassRates:   summarizeBudgetPassRates(attempts),
		CategoryBreakdown: summarizeBuckets(attempts, func(value AttemptResult) string { return value.Category }),
		SourceBreakdown:   summarizeBuckets(attempts, func(value AttemptResult) string { return sourceKey(value) }),
	}
}

func aggregateAttemptsLight(attempts []AttemptResult) LatencyStats {
	latencies := make([]int64, 0, len(attempts))
	for _, attempt := range attempts {
		latencies = append(latencies, attempt.RequestLatencyMS)
	}
	return summarizeLatency(latencies)
}

func summarizeQuality(attempts []AttemptResult) QualitySummary {
	positiveCount := 0
	negativeCount := 0
	positiveExact := 0
	negativeAvoid := 0
	validWinners := 0
	recallAt3 := 0
	charsSavedValues := make([]float64, 0, len(attempts))
	for _, attempt := range attempts {
		if attempt.ValidPrefix {
			validWinners++
		}
		if attempt.CandidateHitAt3 {
			recallAt3++
		}
		if attempt.CharsSavedRatio > 0 {
			charsSavedValues = append(charsSavedValues, attempt.CharsSavedRatio)
		} else {
			charsSavedValues = append(charsSavedValues, 0)
		}
		if attempt.LabelKind == LabelKindNegative {
			negativeCount++
			if attempt.NegativeAvoided {
				negativeAvoid++
			}
			continue
		}
		positiveCount++
		if attempt.ExactMatch {
			positiveExact++
		}
	}
	total := len(attempts)
	return QualitySummary{
		PositiveCaseCount:    positiveCount,
		NegativeCaseCount:    negativeCount,
		PositiveExactHitRate: ratio(positiveExact, positiveCount),
		NegativeAvoidRate:    ratio(negativeAvoid, negativeCount),
		ValidWinnerRate:      ratio(validWinners, total),
		CandidateRecallAt3:   ratio(recallAt3, total),
		CharsSavedRatio:      average(charsSavedValues),
	}
}

func summarizeStartStates(attempts []AttemptResult) []StartStateSummary {
	keys := []StartState{StartStateCold, StartStateHot, StartStateUnknown, StartStateNotApplicable}
	result := make([]StartStateSummary, 0, len(keys))
	total := len(attempts)
	for _, key := range keys {
		group := filterAttempts(attempts, func(value AttemptResult) bool { return value.StartState == key })
		if len(group) == 0 {
			continue
		}
		result = append(result, StartStateSummary{
			Key:     key,
			Count:   len(group),
			Share:   ratio(len(group), total),
			Latency: aggregateAttemptsLight(group),
		})
	}
	return result
}

func summarizeStages(attempts []AttemptResult) []StageSummary {
	result := make([]StageSummary, 0, 2)
	for _, state := range []StartState{StartStateCold, StartStateHot} {
		group := filterAttempts(attempts, func(value AttemptResult) bool { return value.StartState == state })
		if len(group) == 0 {
			continue
		}
		result = append(result, StageSummary{
			Label:                   string(state),
			Count:                   len(group),
			AvgRequestLatencyMS:     averageDuration(group, func(value AttemptResult) int64 { return value.RequestLatencyMS }),
			AvgModelTotalDurationMS: averageDuration(group, func(value AttemptResult) int64 { return value.ModelTotalDurationMS }),
			AvgLoadDurationMS:       averageDuration(group, func(value AttemptResult) int64 { return value.ModelLoadDurationMS }),
			AvgPromptEvalDurationMS: averageDuration(group, func(value AttemptResult) int64 { return value.ModelPromptEvalDurationMS }),
			AvgEvalDurationMS:       averageDuration(group, func(value AttemptResult) int64 { return value.ModelEvalDurationMS }),
			AvgNonModelOverheadMS:   averageDuration(group, func(value AttemptResult) int64 { return value.NonModelOverheadDurationMS }),
			DecodeTokensPerSecond: average(func() []float64 {
				values := make([]float64, 0, len(group))
				for _, value := range group {
					values = append(values, value.DecodeTokensPerSecond)
				}
				return values
			}()),
		})
	}
	return result
}

func summarizeBudgetPassRates(attempts []AttemptResult) []BudgetPassRate {
	budgets := []float64{150, 300, 500, 1000}
	result := make([]BudgetPassRate, 0, len(budgets))
	for _, budget := range budgets {
		passed := 0
		for _, attempt := range attempts {
			if float64(attempt.RequestLatencyMS) <= budget {
				passed++
			}
		}
		result = append(result, BudgetPassRate{
			BudgetMS: budget,
			Rate:     ratio(passed, len(attempts)),
		})
	}
	return result
}

func summarizeBuckets(attempts []AttemptResult, keyFn func(AttemptResult) string) []BucketSummary {
	buckets := map[string][]AttemptResult{}
	var keys []string
	for _, attempt := range attempts {
		key := strings.TrimSpace(keyFn(attempt))
		if key == "" {
			key = "(unknown)"
		}
		if _, exists := buckets[key]; !exists {
			keys = append(keys, key)
		}
		buckets[key] = append(buckets[key], attempt)
	}
	sort.Strings(keys)
	result := make([]BucketSummary, 0, len(keys))
	total := len(attempts)
	for _, key := range keys {
		group := buckets[key]
		result = append(result, BucketSummary{
			Key:     key,
			Label:   key,
			Count:   len(group),
			Share:   ratio(len(group), total),
			Quality: summarizeQuality(group),
			Latency: aggregateAttemptsLight(group),
		})
	}
	return result
}

func sourceKey(attempt AttemptResult) string {
	if strings.TrimSpace(attempt.WinnerSource) != "" {
		return attempt.WinnerSource
	}
	return "model"
}

func averageDuration(values []AttemptResult, fn func(AttemptResult) int64) float64 {
	converted := make([]float64, 0, len(values))
	for _, value := range values {
		converted = append(converted, float64(max64(0, fn(value))))
	}
	return average(converted)
}

func notifyProgress(progress ProgressWriter, update Progress) {
	if progress != nil {
		progress(update)
	}
}

func filterAttempts(values []AttemptResult, fn func(AttemptResult) bool) []AttemptResult {
	result := make([]AttemptResult, 0, len(values))
	for _, value := range values {
		if fn(value) {
			result = append(result, value)
		}
	}
	return result
}

func ratio(part, total int) float64 {
	if total <= 0 {
		return 0
	}
	return float64(part) / float64(total)
}

func percent(part, total int) int {
	if total <= 0 {
		return 0
	}
	return int((float64(part) / float64(total)) * 100)
}

func max64(a, b int64) int64 {
	if a >= b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a >= b {
		return a
	}
	return b
}

func intPtr(value int) *int { return &value }

func statusForRunError(err error) string {
	if err != nil {
		return "failed"
	}
	return "completed"
}

func lastAttemptModel(values []AttemptResult) string {
	if len(values) == 0 {
		return ""
	}
	return values[len(values)-1].Model
}

func lastAttemptCase(values []AttemptResult) string {
	if len(values) == 0 {
		return ""
	}
	return values[len(values)-1].CaseName
}

func lastAttemptRun(values []AttemptResult) int {
	if len(values) == 0 {
		return 0
	}
	return values[len(values)-1].Run
}

func lastAttemptPhase(values []AttemptResult) TimingPhase {
	if len(values) == 0 {
		return ""
	}
	return values[len(values)-1].TimingPhase
}

func EncodeArtifact(artifact Artifact) ([]byte, error) {
	return json.MarshalIndent(artifact, "", "  ")
}
