package engine

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/SuperCorks/cli-auto-complete/internal/api"
	"github.com/SuperCorks/cli-auto-complete/internal/config"
	"github.com/SuperCorks/cli-auto-complete/internal/db"
	"github.com/SuperCorks/cli-auto-complete/internal/model"
	"github.com/SuperCorks/cli-auto-complete/internal/model/ollama"
)

type Engine struct {
	store          *db.Store
	modelClient    model.Client
	modelName      string
	modelBaseURL   string
	suggestStrategy string
	suggestTimeout time.Duration
}

type rankedCandidate struct {
	Command      string
	Source       string
	Score        int
	LatencyMS    int64
	Feedback     db.CommandFeedbackStats
	HistoryScore int
	ModelScore   int
	FeedbackAdj  int
	RecentAdj    int
	LastCtxAdj   int
}

func New(store *db.Store, modelClient model.Client, modelName, modelBaseURL, suggestStrategy string, suggestTimeout time.Duration) *Engine {
	return &Engine{
		store:          store,
		modelClient:    modelClient,
		modelName:      modelName,
		modelBaseURL:   modelBaseURL,
		suggestStrategy: config.NormalizeSuggestStrategy(suggestStrategy),
		suggestTimeout: suggestTimeout,
	}
}

func (e *Engine) Suggest(ctx context.Context, request api.SuggestRequest) (api.SuggestResponse, error) {
	if err := e.store.EnsureSession(ctx, request.SessionID); err != nil {
		return api.SuggestResponse{}, err
	}

	buffer := strings.TrimSpace(request.Buffer)
	if buffer == "" {
		return api.SuggestResponse{}, nil
	}

	recentCommands := request.RecentCommands
	var err error
	inspection, err := e.inspect(ctx, api.InspectRequest{
		SessionID:      request.SessionID,
		Buffer:         request.Buffer,
		CWD:            request.CWD,
		RepoRoot:       request.RepoRoot,
		Branch:         request.Branch,
		LastExitCode:   request.LastExitCode,
		RecentCommands: recentCommands,
		Strategy:       request.Strategy,
		Limit:          8,
	})
	if err != nil {
		return api.SuggestResponse{}, err
	}

	if len(inspection.Candidates) == 0 || inspection.Winner == nil {
		return api.SuggestResponse{}, nil
	}
	winner := inspection.Winner
	return e.recordSuggestion(ctx, request, rankedCandidate{
		Command:      winner.Command,
		Source:       winner.Source,
		Score:        winner.Score,
		LatencyMS:    winner.LatencyMS,
		HistoryScore: winner.HistoryScore,
		Feedback: db.CommandFeedbackStats{
			AcceptedCount: winner.AcceptedCount,
			RejectedCount: winner.RejectedCount,
		},
		ModelScore:  winner.Breakdown.Model,
		FeedbackAdj: winner.Breakdown.Feedback,
		RecentAdj:   winner.Breakdown.RecentUsage,
		LastCtxAdj:  winner.Breakdown.LastContext,
	})
}

func (e *Engine) Inspect(ctx context.Context, request api.InspectRequest) (api.InspectResponse, error) {
	return e.inspect(ctx, request)
}

func (e *Engine) inspect(ctx context.Context, request api.InspectRequest) (api.InspectResponse, error) {
	if err := e.store.EnsureSession(ctx, request.SessionID); err != nil {
		return api.InspectResponse{}, err
	}

	buffer := strings.TrimSpace(request.Buffer)
	if buffer == "" {
		return api.InspectResponse{}, nil
	}

	limit := request.Limit
	if limit <= 0 {
		limit = 8
	}

	recentCommands := request.RecentCommands
	var err error
	if len(recentCommands) == 0 {
		recentCommands, err = e.store.GetRecentCommands(ctx, request.SessionID, 12)
		if err != nil {
			return api.InspectResponse{}, err
		}
	}
	if recentCommands == nil {
		recentCommands = []string{}
	}

	lastContext, err := e.store.GetLastCommandContext(ctx, request.SessionID)
	if err != nil {
		return api.InspectResponse{}, err
	}

	candidateMap := map[string]*rankedCandidate{}
	strategy := config.NormalizeSuggestStrategy(request.Strategy)
	if strategy == "" {
		strategy = e.suggestStrategy
	}
	useHistory := strategy != config.SuggestStrategyModelOnly
	useModel := strategy != config.SuggestStrategyHistoryOnly

	if useHistory {
		historyCandidates, err := e.store.FindCommandCandidates(ctx, buffer, request.CWD, request.RepoRoot, request.Branch, limit)
		if err != nil {
			return api.InspectResponse{}, err
		}

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

	initialCandidates := sortedCandidates(candidateMap)
	historyTrusted := useHistory && len(initialCandidates) > 0 && shouldTrustHistory(initialCandidates)
	prompt := BuildPrompt(api.SuggestRequest{
		SessionID:      request.SessionID,
		Buffer:         request.Buffer,
		CWD:            request.CWD,
		RepoRoot:       request.RepoRoot,
		Branch:         request.Branch,
		LastExitCode:   request.LastExitCode,
		RecentCommands: recentCommands,
		Strategy:       strategy,
	}, recentCommands, lastContext)

	rawModelOutput := ""
	cleanedModelOutput := ""
	activeModelName := e.modelName

	if useModel && (strategy == config.SuggestStrategyModelOnly || !historyTrusted) {
		modelClient := e.modelClient
		if request.ModelName != "" && request.ModelName != e.modelName {
			baseURL := request.ModelBaseURL
			if baseURL == "" {
				baseURL = e.modelBaseURL
			}
			modelClient = ollama.New(baseURL, request.ModelName)
			activeModelName = request.ModelName
		}

		if modelClient != nil {
			modelCtx, cancel := context.WithTimeout(ctx, e.suggestTimeout)
			startedAt := time.Now()
			rawSuggestion, modelErr := modelClient.Suggest(modelCtx, prompt)
			cancel()
			if modelErr == nil {
				rawModelOutput = rawSuggestion
				cleanedModelOutput = CleanSuggestion(buffer, rawSuggestion)
				if cleanedModelOutput != "" {
					candidate := candidateMap[cleanedModelOutput]
					if candidate == nil {
						candidate = &rankedCandidate{
							Command: cleanedModelOutput,
							Source:  "model",
						}
						candidateMap[cleanedModelOutput] = candidate
					} else if !strings.Contains(candidate.Source, "model") {
						candidate.Source += "+model"
					}

					candidate.LatencyMS = time.Since(startedAt).Milliseconds()
					candidate.ModelScore = scoreModelCandidate(cleanedModelOutput, api.SuggestRequest{
						SessionID:      request.SessionID,
						Buffer:         request.Buffer,
						CWD:            request.CWD,
						RepoRoot:       request.RepoRoot,
						Branch:         request.Branch,
						LastExitCode:   request.LastExitCode,
						RecentCommands: recentCommands,
					}, recentCommands, lastContext)
					candidate.Score = max(candidate.Score, candidate.ModelScore)
				}
			}
		}
	}

	if len(candidateMap) == 0 {
		return api.InspectResponse{
			ModelName:          activeModelName,
			HistoryTrusted:     historyTrusted,
			Prompt:             prompt,
			RawModelOutput:     rawModelOutput,
			CleanedModelOutput: cleanedModelOutput,
			RecentCommands:     recentCommands,
			LastCommand:        lastContext.Command,
			LastStdoutExcerpt:  lastContext.StdoutExcerpt,
			LastStderrExcerpt:  lastContext.StderrExcerpt,
			Candidates:         []api.InspectCandidate{},
		}, nil
	}

	feedbackStats, err := e.store.GetCommandFeedbackStats(ctx, candidateCommands(candidateMap))
	if err != nil {
		return api.InspectResponse{}, err
	}

	for command, candidate := range candidateMap {
		stats := feedbackStats[command]
		candidate.Feedback = stats
		candidate.FeedbackAdj = scoreFeedback(stats)
		candidate.RecentAdj = scoreRecentUsage(command, recentCommands)
		candidate.LastCtxAdj = scoreLastContext(command, lastContext, request.LastExitCode)
		candidate.Score += candidate.FeedbackAdj + candidate.RecentAdj + candidate.LastCtxAdj
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
				History:     candidate.HistoryScore,
				Model:       candidate.ModelScore,
				Feedback:    candidate.FeedbackAdj,
				RecentUsage: candidate.RecentAdj,
				LastContext: candidate.LastCtxAdj,
				Total:       candidate.Score,
			},
		})
	}

	response := api.InspectResponse{
		ModelName:          activeModelName,
		HistoryTrusted:     historyTrusted,
		Prompt:             prompt,
		RawModelOutput:     rawModelOutput,
		CleanedModelOutput: cleanedModelOutput,
		RecentCommands:     recentCommands,
		LastCommand:        lastContext.Command,
		LastStdoutExcerpt:  lastContext.StdoutExcerpt,
		LastStderrExcerpt:  lastContext.StderrExcerpt,
		Candidates:         inspectCandidates,
	}
	if len(inspectCandidates) > 0 {
		response.Winner = &inspectCandidates[0]
	}
	return response, nil
}

func (e *Engine) recordSuggestion(ctx context.Context, request api.SuggestRequest, candidate rankedCandidate) (api.SuggestResponse, error) {
	suggestionID, err := e.store.CreateSuggestion(ctx, db.SuggestionRecord{
		SessionID:    request.SessionID,
		Buffer:       request.Buffer,
		Suggestion:   candidate.Command,
		Source:       candidate.Source,
		CWD:          request.CWD,
		RepoRoot:     request.RepoRoot,
		Branch:       request.Branch,
		LastExitCode: request.LastExitCode,
		LatencyMS:    candidate.LatencyMS,
		ModelName:    modelNameForSource(e.modelName, candidate.Source),
		CreatedAtMS:  time.Now().UnixMilli(),
	})
	if err != nil {
		return api.SuggestResponse{}, err
	}

	return api.SuggestResponse{
		SuggestionID: suggestionID,
		Suggestion:   candidate.Command,
		Source:       candidate.Source,
	}, nil
}

func BuildPrompt(request api.SuggestRequest, recentCommands []string, lastContext db.CommandContext) string {
	var builder strings.Builder
	builder.WriteString("You are a shell autosuggestion engine.\n")
	builder.WriteString("Complete the current shell command with the single most likely next command.\n")
	builder.WriteString("Return exactly one shell command on one line.\n")
	builder.WriteString("Do not include markdown, backticks, bullets, labels, colons, explanations, comments, cwd annotations, or placeholders.\n")
	builder.WriteString("Prefer the shortest valid continuation that the user is likely to actually run.\n")
	builder.WriteString("Never invent explanatory suffixes like paths, notes, or metadata.\n")
	builder.WriteString("The returned command must begin exactly with the current buffer.\n\n")
	builder.WriteString("examples:\n")
	builder.WriteString("buffer: git st\ncommand: git status\n")
	builder.WriteString("buffer: npm run d\ncommand: npm run dev\n")
	builder.WriteString("buffer: gcloud auth l\ncommand: gcloud auth list\n\n")
	builder.WriteString(fmt.Sprintf("cwd: %s\n", request.CWD))
	builder.WriteString(fmt.Sprintf("repo_root: %s\n", request.RepoRoot))
	builder.WriteString(fmt.Sprintf("branch: %s\n", request.Branch))
	builder.WriteString(fmt.Sprintf("last_exit_code: %d\n", request.LastExitCode))
	if lastContext.Command != "" {
		builder.WriteString(fmt.Sprintf("last_command: %s\n", lastContext.Command))
	}
	if lastContext.StdoutExcerpt != "" {
		builder.WriteString("last_stdout_excerpt:\n")
		builder.WriteString(lastContext.StdoutExcerpt)
		builder.WriteString("\n")
	}
	if lastContext.StderrExcerpt != "" {
		builder.WriteString("last_stderr_excerpt:\n")
		builder.WriteString(lastContext.StderrExcerpt)
		builder.WriteString("\n")
	}
	builder.WriteString("recent_commands:\n")
	for _, command := range recentCommands {
		builder.WriteString("- ")
		builder.WriteString(command)
		builder.WriteString("\n")
	}
	builder.WriteString("\ncurrent_buffer:\n")
	builder.WriteString(request.Buffer)
	builder.WriteString("\n")
	return builder.String()
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
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		if line == prefix {
			return ""
		}
		return line
	}
	return ""
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

func max(left, right int) int {
	if left > right {
		return left
	}
	return right
}
