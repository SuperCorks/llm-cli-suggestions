package engine

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/SuperCorks/llm-cli-suggestions/internal/api"
	"github.com/SuperCorks/llm-cli-suggestions/internal/db"
)

type retrievalCandidate struct {
	Command string
	Source  string
	Score   int
}

func buildRetrievedContext(ctx context.Context, request api.SuggestRequest, historyCandidates []db.CommandCandidate) (api.InspectRetrievedContext, []retrievalCandidate) {
	result := api.InspectRetrievedContext{
		CurrentToken: currentToken(request.Buffer),
	}

	for _, candidate := range historyCandidates {
		if len(result.HistoryMatches) >= 5 {
			break
		}
		command := CleanSuggestion(request.Buffer, candidate.Command)
		if command == "" {
			continue
		}
		result.HistoryMatches = append(result.HistoryMatches, command)
	}

	pathMatches, pathCandidates := retrievePathMatches(request)
	result.PathMatches = pathMatches

	branchMatches, branchCandidates := retrieveGitBranchMatches(ctx, request)
	result.GitBranchMatches = branchMatches

	projectTasks := loadProjectTasks(request.CWD, request.RepoRoot)
	result.ProjectTasks = projectTasks

	taskMatches, taskCandidates := retrieveProjectTaskMatches(request.Buffer, projectTasks)
	result.ProjectTaskMatches = taskMatches

	candidates := make([]retrievalCandidate, 0, len(pathCandidates)+len(branchCandidates)+len(taskCandidates))
	candidates = append(candidates, pathCandidates...)
	candidates = append(candidates, branchCandidates...)
	candidates = append(candidates, taskCandidates...)
	return result, candidates
}

func retrievePathMatches(request api.SuggestRequest) ([]string, []retrievalCandidate) {
	token := currentToken(request.Buffer)
	if token == "" {
		return nil, nil
	}
	if !shouldUsePathRetrieval(request.Buffer) {
		return nil, nil
	}

	dirPath, dirPrefix, basePrefix, ok := resolvePathSearchRoot(request.CWD, token)
	if !ok {
		return nil, nil
	}

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, nil
	}

	type match struct {
		display string
		score   int
	}

	matches := make([]match, 0, 12)
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(strings.ToLower(name), strings.ToLower(basePrefix)) {
			continue
		}
		if !isSafeUnquotedToken(name) {
			continue
		}

		display := dirPrefix + name
		score := 18
		if entry.IsDir() {
			display += "/"
			score += 4
		}
		if strings.HasPrefix(name, ".") && !strings.HasPrefix(basePrefix, ".") {
			score -= 3
		}
		if name == basePrefix {
			score -= 8
		}
		matches = append(matches, match{display: display, score: score})
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		return matches[i].display < matches[j].display
	})
	if len(matches) > 12 {
		matches = matches[:12]
	}

	pathMatches := make([]string, 0, len(matches))
	candidates := make([]retrievalCandidate, 0, len(matches))
	for _, item := range matches {
		pathMatches = append(pathMatches, item.display)
		candidates = append(candidates, retrievalCandidate{
			Command: replaceCurrentToken(request.Buffer, item.display),
			Source:  "path",
			Score:   item.score,
		})
	}
	return pathMatches, candidates
}

func retrieveGitBranchMatches(ctx context.Context, request api.SuggestRequest) ([]string, []retrievalCandidate) {
	token := currentToken(request.Buffer)
	if token == "" || request.RepoRoot == "" || !shouldUseGitBranchRetrieval(request.Buffer) {
		return nil, nil
	}

	cmd := exec.CommandContext(
		ctx,
		"git",
		"-C",
		request.RepoRoot,
		"for-each-ref",
		"--format=%(refname:short)",
		"refs/heads",
		"refs/remotes",
	)
	output, err := cmd.Output()
	if err != nil {
		return nil, nil
	}

	seen := map[string]struct{}{}
	matches := make([]string, 0, 10)
	candidates := make([]retrievalCandidate, 0, 10)
	for _, line := range strings.Split(string(output), "\n") {
		branch := strings.TrimSpace(line)
		if branch == "" || strings.HasSuffix(branch, "/HEAD") {
			continue
		}
		if !strings.HasPrefix(strings.ToLower(branch), strings.ToLower(token)) {
			continue
		}
		if _, exists := seen[branch]; exists {
			continue
		}
		seen[branch] = struct{}{}
		matches = append(matches, branch)
		candidates = append(candidates, retrievalCandidate{
			Command: replaceCurrentToken(request.Buffer, branch),
			Source:  "git-branch",
			Score:   26,
		})
		if len(matches) >= 10 {
			break
		}
	}
	return matches, candidates
}

func retrieveProjectTaskMatches(buffer string, tasks []string) ([]string, []retrievalCandidate) {
	_, token, ok := detectProjectTaskContext(buffer)
	if !ok || token == "" || len(tasks) == 0 {
		return nil, nil
	}

	matches := make([]string, 0, 10)
	candidates := make([]retrievalCandidate, 0, 10)
	for _, task := range tasks {
		if !strings.HasPrefix(strings.ToLower(task), strings.ToLower(token)) {
			continue
		}
		matches = append(matches, task)
		candidates = append(candidates, retrievalCandidate{
			Command: replaceCurrentToken(buffer, task),
			Source:  "project-task",
			Score:   28,
		})
		if len(matches) >= 10 {
			break
		}
	}
	return matches, candidates
}

func shouldUsePathRetrieval(buffer string) bool {
	fields := strings.Fields(buffer)
	if len(fields) == 0 {
		return false
	}
	if strings.HasSuffix(buffer, " ") {
		return false
	}

	last := fields[len(fields)-1]
	if strings.HasPrefix(last, "-") {
		return false
	}
	if strings.Contains(last, "/") || strings.HasPrefix(last, ".") || strings.HasPrefix(last, "~") {
		return true
	}

	if len(fields) >= 2 && fields[0] == "git" {
		switch fields[1] {
		case "add", "restore", "diff", "rm", "mv", "checkout":
			return true
		}
	}

	switch fields[0] {
	case "cd", "ls", "cat", "open", "code", "vim", "nvim", "nano", "less", "bat", "rm", "cp", "mv", "touch", "mkdir":
		return true
	}

	return false
}

func resolvePathSearchRoot(cwd, token string) (string, string, string, bool) {
	dirPrefix := ""
	basePrefix := token
	searchDir := cwd

	if strings.HasPrefix(token, "~/") {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", "", "", false
		}
		searchDir = filepath.Join(homeDir, filepath.Dir(strings.TrimPrefix(token, "~/")))
		dirPrefix = token[:strings.LastIndex(token, "/")+1]
		basePrefix = token[strings.LastIndex(token, "/")+1:]
	} else if strings.Contains(token, "/") {
		dirPart := token[:strings.LastIndex(token, "/")+1]
		basePrefix = token[strings.LastIndex(token, "/")+1:]
		dirPrefix = dirPart
		if filepath.IsAbs(dirPart) {
			searchDir = filepath.Clean(dirPart)
		} else {
			searchDir = filepath.Join(cwd, filepath.Clean(dirPart))
		}
	}

	if searchDir == "" {
		return "", "", "", false
	}
	return searchDir, dirPrefix, basePrefix, true
}

func shouldUseGitBranchRetrieval(buffer string) bool {
	fields := strings.Fields(buffer)
	if len(fields) < 3 {
		return false
	}
	if fields[0] != "git" {
		return false
	}
	if strings.Contains(buffer, " -- ") {
		return false
	}
	switch fields[1] {
	case "checkout", "switch", "merge", "rebase", "branch", "cherry-pick":
		return !strings.HasPrefix(fields[len(fields)-1], "-")
	default:
		return false
	}
}

func detectProjectTaskContext(buffer string) (string, string, bool) {
	fields := strings.Fields(buffer)
	if len(fields) < 2 || strings.HasSuffix(buffer, " ") {
		return "", "", false
	}

	switch {
	case len(fields) >= 3 && fields[0] == "npm" && fields[1] == "run":
		return "npm run", fields[len(fields)-1], true
	case len(fields) >= 3 && fields[0] == "pnpm" && fields[1] == "run":
		return "pnpm run", fields[len(fields)-1], true
	case len(fields) >= 3 && fields[0] == "yarn" && fields[1] == "run":
		return "yarn run", fields[len(fields)-1], true
	case fields[0] == "make":
		return "make", fields[len(fields)-1], true
	case fields[0] == "just":
		return "just", fields[len(fields)-1], true
	default:
		return "", "", false
	}
}

func loadProjectTasks(cwd, repoRoot string) []string {
	result := make([]string, 0, 24)
	seen := map[string]struct{}{}
	appendUnique := func(values []string) {
		for _, value := range values {
			if value == "" {
				continue
			}
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			result = append(result, value)
			if len(result) >= 24 {
				return
			}
		}
	}

	appendUnique(loadPackageScripts(cwd, repoRoot))
	if len(result) < 24 {
		appendUnique(loadMakeTargets(cwd, repoRoot))
	}
	if len(result) < 24 {
		appendUnique(loadJustTargets(cwd, repoRoot))
	}
	if len(result) > 24 {
		return result[:24]
	}
	return result
}

func loadPackageScripts(cwd, repoRoot string) []string {
	for _, root := range []string{cwd, repoRoot} {
		if root == "" {
			continue
		}
		path := filepath.Join(root, "package.json")
		content, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var payload struct {
			Scripts map[string]string `json:"scripts"`
		}
		if err := json.Unmarshal(content, &payload); err != nil {
			continue
		}
		if len(payload.Scripts) == 0 {
			continue
		}
		result := make([]string, 0, len(payload.Scripts))
		for key := range payload.Scripts {
			result = append(result, key)
		}
		sort.Strings(result)
		return result
	}
	return nil
}

func loadMakeTargets(cwd, repoRoot string) []string {
	for _, root := range []string{cwd, repoRoot} {
		targets := loadColonTargets(filepath.Join(root, "Makefile"))
		if len(targets) > 0 {
			return targets
		}
	}
	return nil
}

func loadJustTargets(cwd, repoRoot string) []string {
	for _, root := range []string{cwd, repoRoot} {
		for _, fileName := range []string{"justfile", "Justfile"} {
			targets := loadColonTargets(filepath.Join(root, fileName))
			if len(targets) > 0 {
				return targets
			}
		}
	}
	return nil
}

func loadColonTargets(path string) []string {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()

	targets := make([]string, 0, 16)
	seen := map[string]struct{}{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ".") {
			continue
		}
		if strings.Contains(line, "=") {
			continue
		}
		colon := strings.Index(line, ":")
		if colon <= 0 {
			continue
		}
		targetPart := strings.TrimSpace(line[:colon])
		if targetPart == "" || strings.Contains(targetPart, "%") {
			continue
		}
		for _, target := range strings.Fields(targetPart) {
			if !isSafeUnquotedToken(target) {
				continue
			}
			if _, exists := seen[target]; exists {
				continue
			}
			seen[target] = struct{}{}
			targets = append(targets, target)
		}
	}
	sort.Strings(targets)
	return targets
}

func currentToken(buffer string) string {
	trimmed := strings.TrimRight(buffer, " ")
	if trimmed == "" {
		return ""
	}
	fields := strings.Fields(trimmed)
	if len(fields) == 0 {
		return ""
	}
	return fields[len(fields)-1]
}

func replaceCurrentToken(buffer, replacement string) string {
	if strings.TrimSpace(buffer) == "" {
		return replacement
	}
	if strings.HasSuffix(buffer, " ") {
		return buffer + replacement
	}

	trimmed := strings.TrimRight(buffer, " ")
	token := currentToken(trimmed)
	if token == "" {
		return trimmed + replacement
	}
	index := strings.LastIndex(trimmed, token)
	if index < 0 {
		return trimmed
	}
	return trimmed[:index] + replacement
}

func isSafeUnquotedToken(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		switch {
		case r == ' ' || r == '\'' || r == '"' || r == '\\' || r == '`':
			return false
		}
	}
	return true
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
