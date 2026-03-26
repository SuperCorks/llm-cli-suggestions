package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/SuperCorks/llm-cli-suggestions/internal/api"
	"github.com/SuperCorks/llm-cli-suggestions/internal/config"
	"github.com/SuperCorks/llm-cli-suggestions/internal/db"
	"github.com/SuperCorks/llm-cli-suggestions/internal/model"
	"github.com/SuperCorks/llm-cli-suggestions/internal/model/ollama"
)

type Engine struct {
	store              *db.Store
	modelClient        model.Client
	modelName          string
	modelBaseURL       string
	modelKeepAlive     string
	suggestStrategy    string
	systemPromptStatic string
	suggestTimeout     time.Duration
}

type rankedCandidate struct {
	Command        string
	Source         string
	Score          int
	LatencyMS      int64
	Feedback       db.CommandFeedbackStats
	HistoryScore   int
	RetrievalScore int
	ModelScore     int
	FeedbackAdj    int
	RecentAdj      int
	LastCtxAdj     int
	OutputCtxAdj   int
}

type inspectResult struct {
	response         api.InspectResponse
	resolvedRequest  api.SuggestRequest
	winner           *rankedCandidate
	requestModelName string
	modelMetrics     model.SuggestMetrics
}

const (
	recentOutputFetchLimit  = 20
	recentOutputSelectLimit = 3
	recentOutputPromptLimit = 220
	minimumInspectTimeout   = 10 * time.Second
	hotResidentLoadFloorMS  = int64(250)
)

func New(store *db.Store, modelClient model.Client, modelName, modelBaseURL, modelKeepAlive, suggestStrategy string, suggestTimeout time.Duration) *Engine {
	return &Engine{
		store:              store,
		modelClient:        modelClient,
		modelName:          modelName,
		modelBaseURL:       modelBaseURL,
		modelKeepAlive:     modelKeepAlive,
		suggestStrategy:    config.NormalizeSuggestStrategy(suggestStrategy),
		systemPromptStatic: "",
		suggestTimeout:     suggestTimeout,
	}
}

func NewWithSystemPrompt(store *db.Store, modelClient model.Client, modelName, modelBaseURL, modelKeepAlive, suggestStrategy, systemPromptStatic string, suggestTimeout time.Duration) *Engine {
	engine := New(store, modelClient, modelName, modelBaseURL, modelKeepAlive, suggestStrategy, suggestTimeout)
	engine.systemPromptStatic = systemPromptStatic
	return engine
}

func (e *Engine) Suggest(ctx context.Context, request api.SuggestRequest) (api.SuggestResponse, error) {
	if err := e.store.EnsureSession(ctx, request.SessionID); err != nil {
		return api.SuggestResponse{}, err
	}

	requestStartedAt := time.Now()
	recentCommands := request.RecentCommands
	var err error
	inspection, err := e.inspectDetailed(ctx, api.InspectRequest{
		SessionID:      request.SessionID,
		Buffer:         request.Buffer,
		CWD:            request.CWD,
		RepoRoot:       request.RepoRoot,
		Branch:         request.Branch,
		LastExitCode:   intPtr(request.LastExitCode),
		RecentCommands: recentCommands,
		Strategy:       request.Strategy,
		ModelName:      request.ModelName,
		ModelBaseURL:   request.ModelBaseURL,
		Limit:          8,
	}, e.suggestTimeout)
	if err != nil {
		return api.SuggestResponse{}, err
	}

	if len(inspection.response.Candidates) == 0 || inspection.winner == nil {
		e.logSuggestTrace(inspection, nil, time.Since(requestStartedAt).Milliseconds(), 0, false)
		return api.SuggestResponse{}, nil
	}
	return e.recordSuggestion(ctx, inspection, *inspection.winner, time.Since(requestStartedAt).Milliseconds())
}

func (e *Engine) Inspect(ctx context.Context, request api.InspectRequest) (api.InspectResponse, error) {
	inspectTimeout := e.suggestTimeout
	if inspectTimeout < minimumInspectTimeout {
		inspectTimeout = minimumInspectTimeout
	}

	result, err := e.inspectDetailed(ctx, request, inspectTimeout)
	if err != nil {
		return api.InspectResponse{}, err
	}
	return result.response, nil
}

func (e *Engine) inspectDetailed(ctx context.Context, request api.InspectRequest, modelTimeout time.Duration) (inspectResult, error) {
	limit := request.Limit
	if limit <= 0 {
		limit = 8
	}

	resolvedSuggestRequest, recentCommands, lastContext, lastCommandContexts, recentOutputContexts, err := e.resolveInspectContext(ctx, request)
	if err != nil {
		return inspectResult{}, err
	}
	selectedRecentOutput := selectRecentOutputContext(resolvedSuggestRequest, recentOutputContexts)

	candidateMap := map[string]*rankedCandidate{}
	historyCandidates := []db.CommandCandidate{}
	strategy := strings.TrimSpace(request.Strategy)
	if strategy == "" {
		strategy = e.suggestStrategy
	} else {
		strategy = config.NormalizeSuggestStrategy(strategy)
	}
	allowEmptyBufferModel := strings.TrimSpace(request.Buffer) == "" && strings.TrimSpace(lastContext.Command) != ""
	useHistory := strategy != config.SuggestStrategyModelOnly &&
		strategy != config.SuggestStrategyFastThenModel &&
		strings.TrimSpace(request.Buffer) != ""
	useModel := strategy != config.SuggestStrategyHistoryOnly
	if strings.TrimSpace(request.Buffer) == "" && !allowEmptyBufferModel {
		useModel = false
	}
	alwaysInvokeModel := strategy == config.SuggestStrategyHistoryModelAlways ||
		strategy == config.SuggestStrategyHistoryThenModel ||
		strategy == config.SuggestStrategyHistoryThenFastThenModel ||
		strategy == config.SuggestStrategyFastThenModel

	resolvedSuggestRequest.Strategy = strategy
	resolvedSuggestRequest.RecentCommands = recentCommands
	buffer := resolvedSuggestRequest.Buffer
	var retrievedContext api.InspectRetrievedContext
	var retrievalCandidates []retrievalCandidate
	if err := runParallel(
		func() error {
			if !useHistory {
				return nil
			}

			foundCandidates, queryErr := e.store.FindCommandCandidates(
				ctx,
				buffer,
				resolvedSuggestRequest.CWD,
				resolvedSuggestRequest.RepoRoot,
				resolvedSuggestRequest.Branch,
				limit,
			)
			if queryErr != nil {
				return queryErr
			}
			historyCandidates = foundCandidates
			return nil
		},
		func() error {
			retrievedContext, retrievalCandidates = buildStaticRetrievedContext(ctx, resolvedSuggestRequest)
			return nil
		},
	); err != nil {
		return inspectResult{}, err
	}
	retrievedContext.HistoryMatches = historyMatchesForCandidates(buffer, historyCandidates)

	if useHistory {
		for _, historyCandidate := range historyCandidates {
			command := CleanSuggestion(buffer, historyCandidate.Command)
			if command == "" {
				continue
			}

			candidate := candidateMap[command]
			if candidate == nil {
				candidate = &rankedCandidate{
					Command:      command,
					Source:       "history",
					HistoryScore: historyCandidate.Score,
					Score:        historyCandidate.Score,
				}
				candidateMap[command] = candidate
				continue
			}

			candidate.HistoryScore = max(candidate.HistoryScore, historyCandidate.Score)
			candidate.Score = max(candidate.Score, historyCandidate.Score)
		}
	}

	for _, retrievalCandidate := range retrievalCandidates {
		candidate := candidateMap[retrievalCandidate.Command]
		if candidate == nil {
			candidate = &rankedCandidate{
				Command:        retrievalCandidate.Command,
				Source:         retrievalCandidate.Source,
				RetrievalScore: retrievalCandidate.Score,
				Score:          retrievalCandidate.Score,
			}
			candidateMap[retrievalCandidate.Command] = candidate
			continue
		}

		candidate.Source = addSourceTag(candidate.Source, retrievalCandidate.Source)
		candidate.RetrievalScore = max(candidate.RetrievalScore, retrievalCandidate.Score)
		candidate.Score = max(candidate.Score, retrievalCandidate.Score)
	}

	addQuotedGitCommitContextCandidates(candidateMap, buffer, selectedRecentOutput)

	initialCandidates := sortedCandidates(candidateMap)
	historyTrusted := useHistory && len(initialCandidates) > 0 && shouldTrustHistory(initialCandidates)
	inspectLastCommandContext := toInspectCommandContexts(lastCommandContexts)
	prompt := BuildPrompt(e.systemPromptStatic, resolvedSuggestRequest, recentCommands, lastContext, inspectLastCommandContext, selectedRecentOutput, retrievedContext)

	rawModelOutput := ""
	cleanedModelOutput := ""
	modelError := ""
	activeModelName := e.modelName
	requestModelName := ""
	modelMetrics := model.SuggestMetrics{}

	if useModel && (strategy == config.SuggestStrategyModelOnly || strategy == config.SuggestStrategyFastThenModel || alwaysInvokeModel || !historyTrusted) {
		modelClient := e.modelClient
		if request.ModelName != "" && request.ModelName != e.modelName {
			baseURL := request.ModelBaseURL
			if baseURL == "" {
				baseURL = e.modelBaseURL
			}
			modelClient = ollama.New(baseURL, request.ModelName, e.modelKeepAlive)
			activeModelName = request.ModelName
		}

		if modelClient != nil {
			requestModelName = activeModelName
			modelCtx, cancel := context.WithTimeout(ctx, modelTimeout)
			startedAt := time.Now()
			suggestResult, modelErr := modelClient.Suggest(modelCtx, prompt)
			cancel()
			if modelErr == nil {
				modelMetrics = suggestResult.Metrics
				rawModelOutput = suggestResult.Response
				cleanedModelOutput = CleanSuggestion(buffer, suggestResult.Response)
				if cleanedModelOutput != "" {
					candidate := candidateMap[cleanedModelOutput]
					if candidate == nil {
						candidate = &rankedCandidate{
							Command: cleanedModelOutput,
							Source:  "model",
						}
						candidateMap[cleanedModelOutput] = candidate
					} else if !strings.Contains(candidate.Source, "model") {
						candidate.Source = addSourceTag(candidate.Source, "model")
					}

					candidate.LatencyMS = time.Since(startedAt).Milliseconds()
					candidate.ModelScore = scoreModelCandidate(cleanedModelOutput, resolvedSuggestRequest, recentCommands, lastContext)
					candidate.Score = max(candidate.Score, candidate.ModelScore)
				} else if strings.TrimSpace(suggestResult.Response) == "" {
					modelError = fmt.Sprintf("%s returned an empty response.", activeModelName)
				} else {
					modelError = fmt.Sprintf("%s returned output that did not start with the current buffer.", activeModelName)
				}
			} else {
				modelError = formatInspectModelError(activeModelName, modelTimeout, modelErr)
			}
		}
	}

	if len(candidateMap) == 0 {
		return inspectResult{response: api.InspectResponse{
			ModelName:                 activeModelName,
			RequestModelName:          requestModelName,
			HistoryTrusted:            historyTrusted,
			ModelError:                modelError,
			Prompt:                    prompt,
			RawModelOutput:            rawModelOutput,
			CleanedModelOutput:        cleanedModelOutput,
			ModelTotalDurationMS:      modelMetrics.TotalDurationMS,
			ModelLoadDurationMS:       modelMetrics.LoadDurationMS,
			ModelPromptEvalDurationMS: modelMetrics.PromptEvalDurationMS,
			ModelEvalDurationMS:       modelMetrics.EvalDurationMS,
			ModelPromptEvalCount:      modelMetrics.PromptEvalCount,
			ModelEvalCount:            modelMetrics.EvalCount,
			RecentCommands:            recentCommands,
			LastCommand:               lastContext.Command,
			LastStdoutExcerpt:         lastContext.StdoutExcerpt,
			LastStderrExcerpt:         lastContext.StderrExcerpt,
			LastCommandContext:        inspectLastCommandContext,
			RecentOutputContext:       selectedRecentOutput,
			RetrievedContext:          retrievedContext,
			Candidates:                []api.InspectCandidate{},
		}, resolvedRequest: resolvedSuggestRequest, requestModelName: requestModelName, modelMetrics: modelMetrics}, nil
	}

	feedbackStats, err := e.store.GetCommandFeedbackStats(ctx, candidateCommands(candidateMap))
	if err != nil {
		return inspectResult{}, err
	}

	for command, candidate := range candidateMap {
		stats := feedbackStats[command]
		candidate.Feedback = stats
		candidate.FeedbackAdj = scoreFeedback(stats)
		candidate.RecentAdj = scoreRecentUsage(command, recentCommands)
		candidate.LastCtxAdj = scoreLastContext(command, lastContext, resolvedSuggestRequest.LastExitCode)
		candidate.OutputCtxAdj = scoreOutputContext(command, selectedRecentOutput)
		candidate.Score += candidate.FeedbackAdj + candidate.RecentAdj + candidate.LastCtxAdj + candidate.OutputCtxAdj
	}

	ranked := sortedCandidates(candidateMap)
	if len(ranked) > limit {
		ranked = ranked[:limit]
	}

	inspectCandidates := make([]api.InspectCandidate, 0, len(ranked))
	for _, candidate := range ranked {
		inspectCandidates = append(inspectCandidates, api.InspectCandidate{
			Command:       candidate.Command,
			Source:        candidate.Source,
			Score:         candidate.Score,
			LatencyMS:     candidate.LatencyMS,
			HistoryScore:  candidate.HistoryScore,
			AcceptedCount: candidate.Feedback.AcceptedCount,
			RejectedCount: candidate.Feedback.RejectedCount,
			Breakdown: api.InspectCandidateBreakdown{
				History:       candidate.HistoryScore,
				Retrieval:     candidate.RetrievalScore,
				Model:         candidate.ModelScore,
				Feedback:      candidate.FeedbackAdj,
				RecentUsage:   candidate.RecentAdj,
				LastContext:   candidate.LastCtxAdj,
				OutputContext: candidate.OutputCtxAdj,
				Total:         candidate.Score,
			},
		})
	}

	response := api.InspectResponse{
		ModelName:                 activeModelName,
		RequestModelName:          requestModelName,
		HistoryTrusted:            historyTrusted,
		ModelError:                modelError,
		Prompt:                    prompt,
		RawModelOutput:            rawModelOutput,
		CleanedModelOutput:        cleanedModelOutput,
		ModelTotalDurationMS:      modelMetrics.TotalDurationMS,
		ModelLoadDurationMS:       modelMetrics.LoadDurationMS,
		ModelPromptEvalDurationMS: modelMetrics.PromptEvalDurationMS,
		ModelEvalDurationMS:       modelMetrics.EvalDurationMS,
		ModelPromptEvalCount:      modelMetrics.PromptEvalCount,
		ModelEvalCount:            modelMetrics.EvalCount,
		RecentCommands:            recentCommands,
		LastCommand:               lastContext.Command,
		LastStdoutExcerpt:         lastContext.StdoutExcerpt,
		LastStderrExcerpt:         lastContext.StderrExcerpt,
		LastCommandContext:        inspectLastCommandContext,
		RecentOutputContext:       selectedRecentOutput,
		RetrievedContext:          retrievedContext,
		Candidates:                inspectCandidates,
	}
	var winner *rankedCandidate
	if len(inspectCandidates) > 0 {
		response.Winner = &inspectCandidates[0]
		winnerCopy := *ranked[0]
		winner = &winnerCopy
		if response.ModelError != "" {
			response.ModelError = ""
		}
	}
	return inspectResult{
		response:         response,
		resolvedRequest:  resolvedSuggestRequest,
		winner:           winner,
		requestModelName: requestModelName,
		modelMetrics:     modelMetrics,
	}, nil
}

func (e *Engine) resolveInspectContext(ctx context.Context, request api.InspectRequest) (api.SuggestRequest, []string, db.CommandContext, []db.RecentCommandContext, []db.RecentOutputContext, error) {
	resolved := api.SuggestRequest{
		SessionID: request.SessionID,
		Buffer:    request.Buffer,
		CWD:       request.CWD,
		RepoRoot:  request.RepoRoot,
		Branch:    request.Branch,
		Strategy:  request.Strategy,
	}
	recentCommands := request.RecentCommands
	lastContext := db.CommandContext{}
	lastCommandContexts := []db.RecentCommandContext{}
	recentOutputContexts := []db.RecentOutputContext{}

	if request.SessionID != "" {
		if err := runParallel(
			func() error {
				contextValue, queryErr := e.store.GetLastCommandContext(ctx, request.SessionID)
				if queryErr != nil {
					return queryErr
				}
				lastContext = contextValue
				return nil
			},
			func() error {
				if len(recentCommands) != 0 {
					return nil
				}
				commands, queryErr := e.store.GetRecentCommands(ctx, request.SessionID, 12)
				if queryErr != nil {
					return queryErr
				}
				recentCommands = commands
				return nil
			},
			func() error {
				outputs, queryErr := e.store.GetRecentOutputContexts(ctx, request.SessionID, recentOutputFetchLimit)
				if queryErr != nil {
					return queryErr
				}
				recentOutputContexts = outputs
				return nil
			},
			func() error {
				contexts, queryErr := e.store.GetRecentCommandContexts(ctx, request.SessionID, 3)
				if queryErr != nil {
					return queryErr
				}
				lastCommandContexts = contexts
				return nil
			},
		); err != nil {
			return api.SuggestRequest{}, nil, db.CommandContext{}, nil, nil, err
		}
		if resolved.CWD == "" {
			resolved.CWD = lastContext.CWD
		}
		if resolved.CWD != "" {
			if err := e.fillContextGapsFromCWD(ctx, resolved.CWD, &recentCommands, &lastContext, &lastCommandContexts, &recentOutputContexts); err != nil {
				return api.SuggestRequest{}, nil, db.CommandContext{}, nil, nil, err
			}
		}
		if resolved.RepoRoot == "" {
			resolved.RepoRoot = lastContext.RepoRoot
		}
		if resolved.Branch == "" {
			resolved.Branch = lastContext.Branch
		}
	} else if resolved.CWD != "" {
		if err := runParallel(
			func() error {
				contextValue, queryErr := e.store.GetLastCommandContextByCWD(ctx, resolved.CWD)
				if queryErr != nil {
					return queryErr
				}
				lastContext = contextValue
				return nil
			},
			func() error {
				if len(recentCommands) != 0 {
					return nil
				}
				commands, queryErr := e.store.GetRecentCommandsByCWD(ctx, resolved.CWD, 12)
				if queryErr != nil {
					return queryErr
				}
				recentCommands = commands
				return nil
			},
			func() error {
				outputs, queryErr := e.store.GetRecentOutputContextsByCWD(ctx, resolved.CWD, recentOutputFetchLimit)
				if queryErr != nil {
					return queryErr
				}
				recentOutputContexts = outputs
				return nil
			},
			func() error {
				contexts, queryErr := e.store.GetRecentCommandContextsByCWD(ctx, resolved.CWD, 3)
				if queryErr != nil {
					return queryErr
				}
				lastCommandContexts = contexts
				return nil
			},
		); err != nil {
			return api.SuggestRequest{}, nil, db.CommandContext{}, nil, nil, err
		}
		if isZeroCommandContext(lastContext) && len(lastCommandContexts) > 0 {
			lastContext = commandContextFromRecent(lastCommandContexts[0])
		}
		if resolved.RepoRoot == "" {
			resolved.RepoRoot = lastContext.RepoRoot
		}
		if resolved.Branch == "" {
			resolved.Branch = lastContext.Branch
		}
	}

	if request.LastExitCode != nil {
		resolved.LastExitCode = *request.LastExitCode
	} else {
		resolved.LastExitCode = lastContext.ExitCode
	}

	if (resolved.RepoRoot == "" || resolved.Branch == "") && resolved.CWD != "" {
		inferredRepoRoot, inferredBranch := inferGitContext(ctx, resolved.CWD)
		if resolved.RepoRoot == "" {
			resolved.RepoRoot = inferredRepoRoot
		}
		if resolved.Branch == "" {
			resolved.Branch = inferredBranch
		}
	}

	if recentCommands == nil {
		recentCommands = []string{}
	}

	return resolved, recentCommands, lastContext, lastCommandContexts, recentOutputContexts, nil
}

func (e *Engine) fillContextGapsFromCWD(
	ctx context.Context,
	cwd string,
	recentCommands *[]string,
	lastContext *db.CommandContext,
	lastCommandContexts *[]db.RecentCommandContext,
	recentOutputContexts *[]db.RecentOutputContext,
) error {
	if strings.TrimSpace(cwd) == "" {
		return nil
	}
	if len(*recentCommands) != 0 && !isZeroCommandContext(*lastContext) && len(*lastCommandContexts) != 0 && len(*recentOutputContexts) != 0 {
		return nil
	}

	var cwdCommands []string
	var cwdContext db.CommandContext
	var cwdCommandContexts []db.RecentCommandContext
	var cwdOutputContexts []db.RecentOutputContext

	if err := runParallel(
		func() error {
			if len(*recentCommands) != 0 {
				return nil
			}
			commands, queryErr := e.store.GetRecentCommandsByCWD(ctx, cwd, 12)
			if queryErr != nil {
				return queryErr
			}
			cwdCommands = commands
			return nil
		},
		func() error {
			if !isZeroCommandContext(*lastContext) {
				return nil
			}
			contextValue, queryErr := e.store.GetLastCommandContextByCWD(ctx, cwd)
			if queryErr != nil {
				return queryErr
			}
			cwdContext = contextValue
			return nil
		},
		func() error {
			if len(*lastCommandContexts) != 0 {
				return nil
			}
			contexts, queryErr := e.store.GetRecentCommandContextsByCWD(ctx, cwd, 3)
			if queryErr != nil {
				return queryErr
			}
			cwdCommandContexts = contexts
			return nil
		},
		func() error {
			if len(*recentOutputContexts) != 0 {
				return nil
			}
			outputs, queryErr := e.store.GetRecentOutputContextsByCWD(ctx, cwd, recentOutputFetchLimit)
			if queryErr != nil {
				return queryErr
			}
			cwdOutputContexts = outputs
			return nil
		},
	); err != nil {
		return err
	}

	if len(*recentCommands) == 0 {
		*recentCommands = cwdCommands
	}
	if isZeroCommandContext(*lastContext) {
		*lastContext = cwdContext
	}
	if len(*lastCommandContexts) == 0 {
		*lastCommandContexts = cwdCommandContexts
		if isZeroCommandContext(*lastContext) && len(cwdCommandContexts) > 0 {
			*lastContext = commandContextFromRecent(cwdCommandContexts[0])
		}
	}
	if len(*recentOutputContexts) == 0 {
		*recentOutputContexts = cwdOutputContexts
	}

	return nil
}

func commandContextFromRecent(value db.RecentCommandContext) db.CommandContext {
	return db.CommandContext{
		CWD:           value.CWD,
		RepoRoot:      value.RepoRoot,
		Branch:        value.Branch,
		ExitCode:      value.ExitCode,
		Command:       value.Command,
		StdoutExcerpt: value.StdoutExcerpt,
		StderrExcerpt: value.StderrExcerpt,
	}
}

func isZeroCommandContext(value db.CommandContext) bool {
	return value.CWD == "" &&
		value.RepoRoot == "" &&
		value.Branch == "" &&
		value.ExitCode == 0 &&
		value.Command == "" &&
		value.StdoutExcerpt == "" &&
		value.StderrExcerpt == ""
}

func inferGitContext(ctx context.Context, cwd string) (string, string) {
	repoRootOutput, err := exec.CommandContext(ctx, "git", "-C", cwd, "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return "", ""
	}
	repoRoot := strings.TrimSpace(string(repoRootOutput))
	if repoRoot == "" {
		return "", ""
	}

	branchOutput, err := exec.CommandContext(ctx, "git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD").Output()
	if err != nil {
		return repoRoot, ""
	}
	return repoRoot, strings.TrimSpace(string(branchOutput))
}

func intPtr(value int) *int {
	return &value
}

func (e *Engine) recordSuggestion(ctx context.Context, inspection inspectResult, candidate rankedCandidate, requestLatencyMS int64) (api.SuggestResponse, error) {
	modelStartState := classifyLiveStartState(inspection.requestModelName, inspection.modelMetrics)
	suggestionID, err := e.store.CreateSuggestion(ctx, db.SuggestionRecord{
		SessionID:             inspection.resolvedRequest.SessionID,
		Buffer:                inspection.resolvedRequest.Buffer,
		Suggestion:            candidate.Command,
		Source:                candidate.Source,
		CWD:                   inspection.resolvedRequest.CWD,
		RepoRoot:              inspection.resolvedRequest.RepoRoot,
		Branch:                inspection.resolvedRequest.Branch,
		LastExitCode:          inspection.resolvedRequest.LastExitCode,
		LatencyMS:             candidate.LatencyMS,
		RequestLatencyMS:      requestLatencyMS,
		ModelName:             modelNameForSource(inspection.response.ModelName, candidate.Source),
		RequestModelName:      inspection.requestModelName,
		ModelKeepAlive:        e.modelKeepAlive,
		ModelStartState:       modelStartState,
		ModelTotalDurationMS:  inspection.modelMetrics.TotalDurationMS,
		ModelLoadDurationMS:   inspection.modelMetrics.LoadDurationMS,
		ModelPromptEvalMS:     inspection.modelMetrics.PromptEvalDurationMS,
		ModelEvalDurationMS:   inspection.modelMetrics.EvalDurationMS,
		ModelPromptEvalCount:  inspection.modelMetrics.PromptEvalCount,
		ModelEvalCount:        inspection.modelMetrics.EvalCount,
		PromptText:            inspection.response.Prompt,
		StructuredContextJSON: marshalSuggestionContext(inspection, e.modelKeepAlive),
		CreatedAtMS:           time.Now().UnixMilli(),
	})
	if err != nil {
		return api.SuggestResponse{}, err
	}

	e.logSuggestTrace(inspection, &candidate, requestLatencyMS, suggestionID, true)

	return api.SuggestResponse{
		SuggestionID: suggestionID,
		Suggestion:   candidate.Command,
		Source:       candidate.Source,
	}, nil
}

func classifyLiveStartState(requestModelName string, metrics model.SuggestMetrics) string {
	if strings.TrimSpace(requestModelName) == "" {
		return "not-applicable"
	}
	if metrics.TotalDurationMS < 0 || metrics.LoadDurationMS < 0 || metrics.PromptEvalDurationMS < 0 || metrics.EvalDurationMS < 0 || metrics.PromptEvalCount < 0 || metrics.EvalCount < 0 {
		return "unknown"
	}
	if metrics.TotalDurationMS == 0 &&
		metrics.LoadDurationMS == 0 &&
		metrics.PromptEvalDurationMS == 0 &&
		metrics.EvalDurationMS == 0 &&
		metrics.PromptEvalCount == 0 &&
		metrics.EvalCount == 0 {
		return "unknown"
	}
	if metrics.LoadDurationMS >= 0 && metrics.LoadDurationMS <= hotResidentLoadFloorMS {
		return "hot"
	}
	return "cold"
}

func (e *Engine) logSuggestTrace(inspection inspectResult, candidate *rankedCandidate, requestLatencyMS int64, suggestionID int64, stored bool) {
	if requestLatencyMS < 0 {
		requestLatencyMS = 0
	}
	payload := struct {
		Event                string `json:"event"`
		SuggestionID         int64  `json:"suggestion_id,omitempty"`
		Stored               bool   `json:"stored"`
		SessionID            string `json:"session_id,omitempty"`
		Strategy             string `json:"strategy,omitempty"`
		Source               string `json:"source,omitempty"`
		PrimaryModelName     string `json:"primary_model_name,omitempty"`
		ResponseModelName    string `json:"response_model_name,omitempty"`
		RequestModelName     string `json:"request_model_name,omitempty"`
		RequestModelInvoked  bool   `json:"request_model_invoked"`
		ModelKeepAlive       string `json:"model_keep_alive,omitempty"`
		ModelStartState      string `json:"model_start_state,omitempty"`
		HistoryTrusted       bool   `json:"history_trusted"`
		RequestLatencyMS     int64  `json:"request_latency_ms"`
		WinnerLatencyMS      int64  `json:"winner_latency_ms,omitempty"`
		ModelTotalDurationMS int64  `json:"model_total_duration_ms,omitempty"`
		ModelLoadDurationMS  int64  `json:"model_load_duration_ms,omitempty"`
		ModelPromptEvalMS    int64  `json:"model_prompt_eval_duration_ms,omitempty"`
		ModelEvalDurationMS  int64  `json:"model_eval_duration_ms,omitempty"`
		ModelPromptEvalCount int64  `json:"model_prompt_eval_count,omitempty"`
		ModelEvalCount       int64  `json:"model_eval_count,omitempty"`
		PromptChars          int    `json:"prompt_chars"`
		BufferChars          int    `json:"buffer_chars"`
		SuggestionChars      int    `json:"suggestion_chars,omitempty"`
		CandidateCount       int    `json:"candidate_count"`
		ModelError           string `json:"model_error,omitempty"`
	}{
		Event:                "suggest_trace",
		SuggestionID:         suggestionID,
		Stored:               stored,
		SessionID:            inspection.resolvedRequest.SessionID,
		Strategy:             inspection.resolvedRequest.Strategy,
		PrimaryModelName:     e.modelName,
		ResponseModelName:    inspection.response.ModelName,
		RequestModelName:     inspection.requestModelName,
		RequestModelInvoked:  strings.TrimSpace(inspection.requestModelName) != "",
		ModelKeepAlive:       e.modelKeepAlive,
		ModelStartState:      classifyLiveStartState(inspection.requestModelName, inspection.modelMetrics),
		HistoryTrusted:       inspection.response.HistoryTrusted,
		RequestLatencyMS:     requestLatencyMS,
		ModelTotalDurationMS: inspection.modelMetrics.TotalDurationMS,
		ModelLoadDurationMS:  inspection.modelMetrics.LoadDurationMS,
		ModelPromptEvalMS:    inspection.modelMetrics.PromptEvalDurationMS,
		ModelEvalDurationMS:  inspection.modelMetrics.EvalDurationMS,
		ModelPromptEvalCount: inspection.modelMetrics.PromptEvalCount,
		ModelEvalCount:       inspection.modelMetrics.EvalCount,
		PromptChars:          len(inspection.response.Prompt),
		BufferChars:          len(inspection.resolvedRequest.Buffer),
		CandidateCount:       len(inspection.response.Candidates),
		ModelError:           inspection.response.ModelError,
	}
	if candidate != nil {
		payload.Source = candidate.Source
		payload.WinnerLatencyMS = candidate.LatencyMS
		payload.SuggestionChars = len(candidate.Command)
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		log.Printf("suggest_trace marshal_error=%q", err)
		return
	}
	log.Printf("%s", encoded)
}

func marshalSuggestionContext(inspection inspectResult, modelKeepAlive string) string {
	payload := struct {
		Request struct {
			SessionID    string `json:"sessionId"`
			Buffer       string `json:"buffer"`
			CWD          string `json:"cwd"`
			RepoRoot     string `json:"repoRoot"`
			Branch       string `json:"branch"`
			LastExitCode int    `json:"lastExitCode"`
			Strategy     string `json:"strategy"`
		} `json:"request"`
		ModelName           string                           `json:"modelName"`
		RequestModelName    string                           `json:"requestModelName"`
		ModelKeepAlive      string                           `json:"modelKeepAlive"`
		ModelStartState     string                           `json:"modelStartState"`
		HistoryTrusted      bool                             `json:"historyTrusted"`
		RecentCommands      []string                         `json:"recentCommands"`
		LastContext         db.CommandContext                `json:"lastContext"`
		LastCommandContext  []api.InspectCommandContext      `json:"lastCommandContext"`
		RecentOutputContext []api.InspectRecentOutputContext `json:"recentOutputContext"`
		RetrievedContext    api.InspectRetrievedContext      `json:"retrievedContext"`
	}{}

	payload.Request.SessionID = inspection.resolvedRequest.SessionID
	payload.Request.Buffer = inspection.resolvedRequest.Buffer
	payload.Request.CWD = inspection.resolvedRequest.CWD
	payload.Request.RepoRoot = inspection.resolvedRequest.RepoRoot
	payload.Request.Branch = inspection.resolvedRequest.Branch
	payload.Request.LastExitCode = inspection.resolvedRequest.LastExitCode
	payload.Request.Strategy = inspection.resolvedRequest.Strategy
	payload.ModelName = inspection.response.ModelName
	payload.RequestModelName = inspection.requestModelName
	payload.ModelKeepAlive = modelKeepAlive
	payload.ModelStartState = classifyLiveStartState(inspection.requestModelName, inspection.modelMetrics)
	payload.HistoryTrusted = inspection.response.HistoryTrusted
	payload.RecentCommands = inspection.response.RecentCommands
	payload.LastContext = db.CommandContext{
		CWD:           inspection.resolvedRequest.CWD,
		RepoRoot:      inspection.resolvedRequest.RepoRoot,
		Branch:        inspection.resolvedRequest.Branch,
		ExitCode:      inspection.resolvedRequest.LastExitCode,
		Command:       inspection.response.LastCommand,
		StdoutExcerpt: inspection.response.LastStdoutExcerpt,
		StderrExcerpt: inspection.response.LastStderrExcerpt,
	}
	payload.LastCommandContext = inspection.response.LastCommandContext
	payload.RecentOutputContext = inspection.response.RecentOutputContext
	payload.RetrievedContext = inspection.response.RetrievedContext

	encoded, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return string(encoded)
}

func BuildPrompt(
	systemPromptStatic string,
	request api.SuggestRequest,
	recentCommands []string,
	lastContext db.CommandContext,
	lastCommandContext []api.InspectCommandContext,
	recentOutputContext []api.InspectRecentOutputContext,
	retrievedContext api.InspectRetrievedContext,
) string {
	var builder strings.Builder
	systemPrompt := strings.TrimSpace(systemPromptStatic)
	if systemPrompt == "" {
		systemPrompt = config.DefaultSystemPromptStatic
	}
	builder.WriteString(systemPrompt)
	builder.WriteString("\n\n")
	builder.WriteString(fmt.Sprintf("cwd: %s\n", request.CWD))
	builder.WriteString(fmt.Sprintf("repo_root: %s\n", request.RepoRoot))
	builder.WriteString(fmt.Sprintf("branch: %s\n", request.Branch))
	builder.WriteString(fmt.Sprintf("last_exit_code: %d\n", request.LastExitCode))
	builder.WriteString(fmt.Sprintf("current_token: %s\n", retrievedContext.CurrentToken))
	appendRecentContext(&builder, recentCommands, lastContext, lastCommandContext, recentOutputContext)
	appendPromptList(&builder, "matching_history", retrievedContext.HistoryMatches)
	appendPromptList(&builder, "path_matches", retrievedContext.PathMatches)
	appendPromptList(&builder, "git_branch_matches", retrievedContext.GitBranchMatches)
	appendPromptList(&builder, "project_tasks", retrievedContext.ProjectTasks)
	appendPromptList(&builder, "project_task_matches", retrievedContext.ProjectTaskMatches)
	if strings.TrimSpace(request.Buffer) == "" {
		builder.WriteString("\nbuffer is empty. Use last_command and recent context to suggest one full command only when there is a clear, high-confidence next step; prefer correcting the last command or the most likely immediate follow-up, otherwise return an empty response.\n")
	} else {
		builder.WriteString("\nThe current buffer below is literal shell text. Copy it exactly, character-for-character, at the start of your answer.\n")
		builder.WriteString("Preserve unmatched quotes, parentheses, colons, and trailing spaces from the current buffer.\n")
		builder.WriteString("Continue the same command. Ignore recent commands or context that do not share the current buffer prefix.\n")
		appendQuotedCommitPrefixExample(&builder, request.Buffer)
		builder.WriteString("\ncurrent_buffer_begin\n")
		builder.WriteString(request.Buffer)
		builder.WriteString("\ncurrent_buffer_end\n")
	}
	return builder.String()
}

func appendQuotedCommitPrefixExample(builder *strings.Builder, buffer string) {
	if builder == nil || !shouldAddQuotedCommitPrefixExample(buffer) {
		return
	}

	exampleCommand := buffer
	if !strings.HasSuffix(exampleCommand, " ") {
		exampleCommand += " "
	}
	exampleCommand += "describe the change\""

	builder.WriteString("Example:\n")
	builder.WriteString("current_buffer_begin\n")
	builder.WriteString(buffer)
	builder.WriteString("\ncurrent_buffer_end\n")
	builder.WriteString("command: ")
	builder.WriteString(exampleCommand)
	builder.WriteString("\n")
}

func shouldAddQuotedCommitPrefixExample(buffer string) bool {
	trimmed := strings.TrimSpace(buffer)
	if !strings.HasPrefix(trimmed, "git commit") || !strings.Contains(buffer, " -m \"") {
		return false
	}
	return hasUnmatchedUnescapedQuote(buffer, '"')
}

func hasUnmatchedUnescapedQuote(value string, quote byte) bool {
	count := 0
	escaped := false
	for index := 0; index < len(value); index++ {
		current := value[index]
		if escaped {
			escaped = false
			continue
		}
		if current == '\\' {
			escaped = true
			continue
		}
		if current == quote {
			count += 1
		}
	}
	return count%2 == 1
}

type promptRecentContextEntry struct {
	Command       string
	LastCommand   bool
	HasExitCode   bool
	ExitCode      int
	StdoutExcerpt string
	StderrExcerpt string
}

func appendRecentContext(
	builder *strings.Builder,
	recentCommands []string,
	lastContext db.CommandContext,
	lastCommandContext []api.InspectCommandContext,
	recentOutputContext []api.InspectRecentOutputContext,
) {
	entries := []promptRecentContextEntry{}
	indexByCommand := map[string]int{}

	ensureEntry := func(command string) *promptRecentContextEntry {
		command = strings.TrimSpace(command)
		if command == "" {
			return nil
		}
		if index, exists := indexByCommand[command]; exists {
			return &entries[index]
		}
		indexByCommand[command] = len(entries)
		entries = append(entries, promptRecentContextEntry{Command: command})
		return &entries[len(entries)-1]
	}

	mergeEntry := func(
		command string,
		lastCommand bool,
		hasExitCode bool,
		exitCode int,
		stdoutExcerpt string,
		stderrExcerpt string,
	) {
		entry := ensureEntry(command)
		if entry == nil {
			return
		}
		entry.LastCommand = entry.LastCommand || lastCommand
		if hasExitCode && !entry.HasExitCode {
			entry.HasExitCode = true
			entry.ExitCode = exitCode
		}
		if entry.StdoutExcerpt == "" && strings.TrimSpace(stdoutExcerpt) != "" {
			entry.StdoutExcerpt = stdoutExcerpt
		}
		if entry.StderrExcerpt == "" && strings.TrimSpace(stderrExcerpt) != "" {
			entry.StderrExcerpt = stderrExcerpt
		}
	}

	for _, context := range lastCommandContext {
		mergeEntry(context.Command, false, true, context.ExitCode, context.StdoutExcerpt, context.StderrExcerpt)
	}
	for _, command := range recentCommands {
		mergeEntry(command, false, false, 0, "", "")
	}
	for _, snippet := range recentOutputContext {
		mergeEntry(snippet.Command, false, true, snippet.ExitCode, snippet.StdoutExcerpt, snippet.StderrExcerpt)
	}
	mergeEntry(
		lastContext.Command,
		lastContext.Command != "",
		lastContext.Command != "",
		lastContext.ExitCode,
		lastContext.StdoutExcerpt,
		lastContext.StderrExcerpt,
	)
	if len(lastCommandContext) > 0 {
		mergeEntry(
			lastCommandContext[0].Command,
			true,
			true,
			lastCommandContext[0].ExitCode,
			lastCommandContext[0].StdoutExcerpt,
			lastCommandContext[0].StderrExcerpt,
		)
	}

	if len(entries) == 0 {
		return
	}

	builder.WriteString("recent_context:\n")
	for _, entry := range entries {
		builder.WriteString("- command: ")
		builder.WriteString(entry.Command)
		builder.WriteString("\n")
		if entry.LastCommand {
			builder.WriteString("  last_command: true\n")
		}
		if entry.HasExitCode {
			builder.WriteString(fmt.Sprintf("  exit_code: %d\n", entry.ExitCode))
		}
		appendIndentedBlock(builder, "stdout_excerpt", entry.StdoutExcerpt)
		appendIndentedBlock(builder, "stderr_excerpt", entry.StderrExcerpt)
	}
}

func toInspectCommandContexts(values []db.RecentCommandContext) []api.InspectCommandContext {
	result := make([]api.InspectCommandContext, 0, len(values))
	for _, value := range values {
		result = append(result, api.InspectCommandContext{
			Command:       value.Command,
			ExitCode:      value.ExitCode,
			StdoutExcerpt: value.StdoutExcerpt,
			StderrExcerpt: value.StderrExcerpt,
			CWD:           value.CWD,
			RepoRoot:      value.RepoRoot,
			Branch:        value.Branch,
			FinishedAtMS:  value.FinishedAtMS,
		})
	}
	return result
}

func appendIndentedBlock(builder *strings.Builder, label, text string) {
	if strings.TrimSpace(text) == "" {
		return
	}

	builder.WriteString("  ")
	builder.WriteString(label)
	builder.WriteString(":\n")
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		builder.WriteString("    ")
		builder.WriteString(line)
		builder.WriteString("\n")
	}
}

func selectRecentOutputContext(request api.SuggestRequest, candidates []db.RecentOutputContext) []api.InspectRecentOutputContext {
	selected := make([]api.InspectRecentOutputContext, 0, min(len(candidates), recentOutputSelectLimit))
	seen := map[string]struct{}{}

	for index, candidate := range candidates {
		score := scoreRecentOutputSelection(request, candidate, index)
		if score <= 0 {
			continue
		}

		stdoutExcerpt := trimOutputContextText(candidate.StdoutExcerpt)
		stderrExcerpt := trimOutputContextText(candidate.StderrExcerpt)
		if stdoutExcerpt == "" && stderrExcerpt == "" {
			continue
		}

		key := candidate.Command + "\x00" + stdoutExcerpt + "\x00" + stderrExcerpt
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}

		selected = append(selected, api.InspectRecentOutputContext{
			Command:       candidate.Command,
			ExitCode:      candidate.ExitCode,
			StdoutExcerpt: stdoutExcerpt,
			StderrExcerpt: stderrExcerpt,
			FinishedAtMS:  candidate.FinishedAtMS,
			Score:         score,
		})
	}

	sort.Slice(selected, func(i, j int) bool {
		if selected[i].Score != selected[j].Score {
			return selected[i].Score > selected[j].Score
		}
		return selected[i].FinishedAtMS > selected[j].FinishedAtMS
	})

	if len(selected) > recentOutputSelectLimit {
		selected = selected[:recentOutputSelectLimit]
	}

	return selected
}

func scoreRecentOutputSelection(request api.SuggestRequest, context db.RecentOutputContext, index int) int {
	if strings.TrimSpace(context.Command) == "" {
		return 0
	}

	textTokens := tokenSet(strings.Join([]string{
		context.Command,
		context.StdoutExcerpt,
		context.StderrExcerpt,
		context.CWD,
		context.RepoRoot,
		context.Branch,
	}, " "))
	bufferTokens := tokenSet(request.Buffer)
	current := strings.ToLower(currentToken(request.Buffer))

	rootMatch := sameRootCommand(request.Buffer, context.Command)
	tokenOverlap := tokenOverlapCount(bufferTokens, textTokens)
	currentPrefixMatch := prefixTokenMatch(current, textTokens)
	pathOverlap := tokenOverlapCount(tokenSet(request.CWD), textTokens) + tokenOverlapCount(tokenSet(request.RepoRoot), textTokens)
	branchMatch := tokenOverlapCount(tokenSet(request.Branch), textTokens)
	failureRelevant := (context.ExitCode != 0 || context.StderrExcerpt != "") && rootMatch

	if !rootMatch && tokenOverlap == 0 && currentPrefixMatch == 0 && pathOverlap == 0 && branchMatch == 0 && !failureRelevant {
		return 0
	}

	score := max(1, recentOutputFetchLimit-index)
	if rootMatch {
		score += 4
	}
	if context.ExitCode != 0 {
		score += 4
	}
	if context.StderrExcerpt != "" {
		score += 3
	}
	score += min(tokenOverlap*2, 6)
	score += min(currentPrefixMatch*4, 8)
	score += min(pathOverlap, 4)
	score += min(branchMatch*2, 4)
	return score
}

func trimOutputContextText(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}

	runes := []rune(text)
	if len(runes) <= recentOutputPromptLimit {
		return text
	}
	return strings.TrimSpace(string(runes[:recentOutputPromptLimit])) + "..."
}

func scoreOutputContext(command string, contexts []api.InspectRecentOutputContext) int {
	if strings.TrimSpace(command) == "" || len(contexts) == 0 {
		return 0
	}

	commandTokens := tokenSet(command)
	commandCurrentToken := strings.ToLower(currentToken(command))
	score := 0

	for _, context := range contexts {
		contextTokens := tokenSet(strings.Join([]string{
			context.Command,
			context.StdoutExcerpt,
			context.StderrExcerpt,
		}, " "))

		if sameRootCommand(command, context.Command) {
			score += 2
		}
		if context.ExitCode != 0 || context.StderrExcerpt != "" {
			if sameRootCommand(command, context.Command) {
				score += 2
			}
		}
		score += min(tokenOverlapCount(commandTokens, contextTokens), 4)
		score += min(prefixTokenMatch(commandCurrentToken, contextTokens)*2, 4)
	}

	return min(score, 12)
}

func tokenSet(value string) map[string]struct{} {
	result := map[string]struct{}{}
	var builder strings.Builder

	flush := func() {
		if builder.Len() == 0 {
			return
		}
		token := strings.ToLower(builder.String())
		if len(token) >= 2 {
			result[token] = struct{}{}
		}
		builder.Reset()
	}

	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(unicode.ToLower(r))
			continue
		}
		flush()
	}
	flush()

	return result
}

func tokenOverlapCount(left, right map[string]struct{}) int {
	count := 0
	for token := range left {
		if _, exists := right[token]; exists {
			count++
		}
	}
	return count
}

func prefixTokenMatch(token string, tokens map[string]struct{}) int {
	if len(token) < 2 {
		return 0
	}

	count := 0
	for candidate := range tokens {
		if strings.HasPrefix(candidate, token) || strings.HasPrefix(token, candidate) {
			count++
		}
	}
	return count
}

func CleanSuggestion(prefix, raw string) string {
	lines := strings.Split(raw, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(strings.TrimPrefix(line, "$"))
		line = strings.ReplaceAll(line, "\t", " ")
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "```") {
			continue
		}
		if strings.Contains(line, "cwd=") || strings.Contains(line, "cwd:") {
			continue
		}
		if strings.HasPrefix(line, "command:") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "command:"))
		}
		if strings.HasPrefix(line, prefix) {
			if line == prefix {
				return ""
			}
			return line
		}
		if rewritten := rewriteQuotedGitCommitSuggestion(prefix, line); rewritten != "" {
			return rewritten
		}
	}
	return ""
}

func rewriteQuotedGitCommitSuggestion(prefix, line string) string {
	commandPrefix, prefixMessage, ok := splitQuotedGitCommitMessage(prefix)
	if !ok || !strings.HasPrefix(line, commandPrefix) {
		return ""
	}

	rawMessage := line[len(commandPrefix):]
	if strings.HasPrefix(rawMessage, prefixMessage) {
		return line
	}
	if !strings.Contains(prefixMessage, ": ") || !strings.Contains(rawMessage, ": ") {
		if strings.HasSuffix(prefixMessage, ")") && strings.Contains(rawMessage, "): ") {
			rawMessageParts := strings.SplitN(rawMessage, "): ", 2)
			if len(rawMessageParts) != 2 || strings.TrimSpace(rawMessageParts[1]) == "" {
				return ""
			}
			rewritten := commandPrefix + prefixMessage + ": " + rawMessageParts[1]
			if rewritten == prefix || !strings.HasPrefix(rewritten, prefix) {
				return ""
			}
			return rewritten
		}
		return ""
	}

	rawMessageParts := strings.SplitN(rawMessage, ": ", 2)
	if len(rawMessageParts) != 2 || strings.TrimSpace(rawMessageParts[1]) == "" {
		return ""
	}

	rewritten := commandPrefix + prefixMessage + rawMessageParts[1]
	if rewritten == prefix || !strings.HasPrefix(rewritten, prefix) {
		return ""
	}
	return rewritten
}

func splitQuotedGitCommitMessage(buffer string) (string, string, bool) {
	if !shouldAddQuotedCommitPrefixExample(buffer) {
		return "", "", false
	}

	messagePrefixIndex := strings.Index(buffer, ` -m "`)
	if messagePrefixIndex == -1 {
		return "", "", false
	}

	messagePrefixIndex += len(` -m "`)
	return buffer[:messagePrefixIndex], buffer[messagePrefixIndex:], true
}

func addQuotedGitCommitContextCandidates(candidateMap map[string]*rankedCandidate, buffer string, contexts []api.InspectRecentOutputContext) {
	if candidateMap == nil || !shouldAddQuotedCommitPrefixExample(buffer) {
		return
	}

	for _, context := range contexts {
		command := CleanSuggestion(buffer, context.Command)
		if command == "" {
			continue
		}

		candidate := candidateMap[command]
		if candidate == nil {
			candidateMap[command] = &rankedCandidate{
				Command: command,
				Source:  "output-context",
				Score:   1,
			}
			continue
		}

		if !strings.Contains(candidate.Source, "output-context") {
			candidate.Source = addSourceTag(candidate.Source, "output-context")
		}
		if candidate.Score < 1 {
			candidate.Score = 1
		}
	}
}

func formatInspectModelError(modelName string, timeout time.Duration, err error) string {
	if err == nil {
		return ""
	}

	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Sprintf("%s timed out after %s. Increase Suggest Timeout on the Daemon page or warm the model first.", modelName, timeout.Round(time.Millisecond))
	}

	return fmt.Sprintf("%s request failed: %v", modelName, err)
}

func sortedCandidates(candidateMap map[string]*rankedCandidate) []*rankedCandidate {
	result := make([]*rankedCandidate, 0, len(candidateMap))
	for _, candidate := range candidateMap {
		result = append(result, candidate)
	}

	sortCandidates(result)
	return result
}

func candidateCommands(candidateMap map[string]*rankedCandidate) []string {
	result := make([]string, 0, len(candidateMap))
	for command := range candidateMap {
		result = append(result, command)
	}
	return result
}

func shouldTrustHistory(candidates []*rankedCandidate) bool {
	if len(candidates) == 0 {
		return false
	}
	if candidates[0].Source != "history" {
		return false
	}
	if candidates[0].HistoryScore < 34 {
		return false
	}
	if len(candidates) == 1 {
		return true
	}
	return candidates[0].HistoryScore-candidates[1].HistoryScore >= 8
}

func scoreModelCandidate(command string, request api.SuggestRequest, recentCommands []string, lastContext db.CommandContext) int {
	score := 18
	if strings.Contains(command, "  ") {
		score -= 2
	}
	if command == request.Buffer {
		score -= 100
	}
	if containsRecentPrefix(command, recentCommands) {
		score += 8
	}
	if lastContext.Command != "" && sameCommandFamily(command, lastContext.Command) {
		score += 4
	}
	if request.LastExitCode != 0 && lastContext.Command != "" && sameCommandFamily(command, lastContext.Command) {
		score += 4
	}
	return score
}

func scoreFeedback(stats db.CommandFeedbackStats) int {
	return stats.AcceptedCount*6 - stats.RejectedCount*8
}

func scoreRecentUsage(command string, recentCommands []string) int {
	score := 0
	for index, recent := range recentCommands {
		if recent == command {
			score += max(1, 10-index)
		} else if strings.HasPrefix(recent, command) || strings.HasPrefix(command, recent) {
			score += max(1, 5-index)
		}
	}
	return score
}

func scoreLastContext(command string, lastContext db.CommandContext, lastExitCode int) int {
	if lastContext.Command == "" {
		return 0
	}

	score := 0
	if sameCommandFamily(command, lastContext.Command) {
		score += 3
	}
	if lastExitCode != 0 && sameCommandFamily(command, lastContext.Command) {
		score += 5
	}
	if lastContext.StderrExcerpt != "" && sameCommandFamily(command, lastContext.Command) {
		score += 2
	}
	return score
}

func containsRecentPrefix(command string, recentCommands []string) bool {
	for _, recent := range recentCommands {
		if strings.HasPrefix(recent, command) || strings.HasPrefix(command, recent) {
			return true
		}
	}
	return false
}

func sameRootCommand(left, right string) bool {
	leftFields := strings.Fields(left)
	rightFields := strings.Fields(right)
	if len(leftFields) == 0 || len(rightFields) == 0 {
		return false
	}
	return leftFields[0] == rightFields[0]
}

func sameCommandFamily(left, right string) bool {
	leftFields := strings.Fields(left)
	rightFields := strings.Fields(right)
	if len(leftFields) == 0 || len(rightFields) == 0 {
		return false
	}
	if leftFields[0] != rightFields[0] {
		return false
	}
	if len(leftFields) > 1 && len(rightFields) > 1 && leftFields[1] == rightFields[1] {
		return true
	}
	return len(leftFields) == 1 || len(rightFields) == 1
}

func modelNameForSource(modelName, source string) string {
	if strings.Contains(source, "model") {
		return modelName
	}
	return ""
}

func sortCandidates(candidates []*rankedCandidate) {
	for i := 0; i < len(candidates); i++ {
		for j := i + 1; j < len(candidates); j++ {
			if shouldSwapCandidates(candidates[i], candidates[j]) {
				candidates[i], candidates[j] = candidates[j], candidates[i]
			}
		}
	}
}

func shouldSwapCandidates(left, right *rankedCandidate) bool {
	if left.Score != right.Score {
		return left.Score < right.Score
	}
	if left.Feedback.AcceptedCount != right.Feedback.AcceptedCount {
		return left.Feedback.AcceptedCount < right.Feedback.AcceptedCount
	}
	if left.HistoryScore != right.HistoryScore {
		return left.HistoryScore < right.HistoryScore
	}
	return len(left.Command) > len(right.Command)
}

func appendPromptList(builder *strings.Builder, label string, values []string) {
	if len(values) == 0 {
		return
	}
	builder.WriteString(label)
	builder.WriteString(":\n")
	for _, value := range values {
		builder.WriteString("- ")
		builder.WriteString(value)
		builder.WriteString("\n")
	}
}

func addSourceTag(source, tag string) string {
	if source == "" {
		return tag
	}
	for _, part := range strings.Split(source, "+") {
		if part == tag {
			return source
		}
	}
	return source + "+" + tag
}

func max(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func runParallel(tasks ...func() error) error {
	if len(tasks) == 0 {
		return nil
	}

	errs := make(chan error, len(tasks))
	var wg sync.WaitGroup

	for _, task := range tasks {
		if task == nil {
			continue
		}
		wg.Add(1)
		go func(task func() error) {
			defer wg.Done()
			if err := task(); err != nil {
				errs <- err
			}
		}(task)
	}

	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			return err
		}
	}

	return nil
}
