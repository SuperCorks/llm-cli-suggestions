package engine

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/SuperCorks/cli-auto-complete/internal/api"
	"github.com/SuperCorks/cli-auto-complete/internal/db"
	"github.com/SuperCorks/cli-auto-complete/internal/model"
)

type Engine struct {
	store          *db.Store
	modelClient    model.Client
	modelName      string
	suggestTimeout time.Duration
}

type rankedCandidate struct {
	Command      string
	Source       string
	Score        int
	LatencyMS    int64
	Feedback     db.CommandFeedbackStats
	HistoryScore int
}

func New(store *db.Store, modelClient model.Client, modelName string, suggestTimeout time.Duration) *Engine {
	return &Engine{
		store:          store,
		modelClient:    modelClient,
		modelName:      modelName,
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
	if len(recentCommands) == 0 {
		recentCommands, err = e.store.GetRecentCommands(ctx, request.SessionID, 12)
		if err != nil {
			return api.SuggestResponse{}, err
		}
	}

	lastContext, err := e.store.GetLastCommandContext(ctx, request.SessionID)
	if err != nil {
		return api.SuggestResponse{}, err
	}

	historyCandidates, err := e.store.FindCommandCandidates(ctx, buffer, request.CWD, request.RepoRoot, request.Branch, 8)
	if err != nil {
		return api.SuggestResponse{}, err
	}

	candidateMap := map[string]*rankedCandidate{}
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
			}
			candidateMap[command] = candidate
		}

		candidate.HistoryScore = max(candidate.HistoryScore, historyCandidate.Score)
		candidate.Score = max(candidate.Score, historyCandidate.Score)
	}

	initialCandidates := sortedCandidates(candidateMap)
	if len(initialCandidates) > 0 && shouldTrustHistory(initialCandidates) {
		top := initialCandidates[0]
		return e.recordSuggestion(ctx, request, *top)
	}

	if e.modelClient != nil {
		prompt := BuildPrompt(request, recentCommands, lastContext)
		modelCtx, cancel := context.WithTimeout(ctx, e.suggestTimeout)
		startedAt := time.Now()
		modelSuggestion, modelErr := e.modelClient.Suggest(modelCtx, prompt)
		cancel()

		if modelErr == nil {
			command := CleanSuggestion(buffer, modelSuggestion)
			if command != "" {
				candidate := candidateMap[command]
				if candidate == nil {
					candidate = &rankedCandidate{
						Command: command,
						Source:  "model",
					}
					candidateMap[command] = candidate
				} else if !strings.Contains(candidate.Source, "model") {
					candidate.Source += "+model"
				}

				candidate.LatencyMS = time.Since(startedAt).Milliseconds()
				candidate.Score = max(candidate.Score, scoreModelCandidate(command, request, recentCommands, lastContext))
			}
		}
	}

	if len(candidateMap) == 0 {
		return api.SuggestResponse{}, nil
	}

	feedbackStats, err := e.store.GetCommandFeedbackStats(ctx, candidateCommands(candidateMap))
	if err != nil {
		return api.SuggestResponse{}, err
	}

	for command, candidate := range candidateMap {
		stats := feedbackStats[command]
		candidate.Feedback = stats
		candidate.Score += scoreFeedback(stats)
		candidate.Score += scoreRecentUsage(command, recentCommands)
		candidate.Score += scoreLastContext(command, lastContext, request.LastExitCode)
	}

	ranked := sortedCandidates(candidateMap)
	if len(ranked) == 0 {
		return api.SuggestResponse{}, nil
	}

	return e.recordSuggestion(ctx, request, *ranked[0])
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
