package benchmark

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/SuperCorks/llm-cli-suggestions/internal/api"
	"github.com/SuperCorks/llm-cli-suggestions/internal/db"
)

const defaultReplayQueryLimit = 1000

func LoadReplayCases(ctx context.Context, store *db.Store, limit int) ([]Case, error) {
	rows, err := store.ListReplayBenchmarkCandidates(ctx, defaultReplayQueryLimit)
	if err != nil {
		return nil, err
	}

	deduped := make([]Case, 0, len(rows))
	seen := map[string]struct{}{}
	for _, row := range rows {
		replayCase, ok := buildReplayCase(row)
		if !ok {
			continue
		}
		key := replayDedupKey(replayCase)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		deduped = append(deduped, replayCase)
	}

	sort.SliceStable(deduped, func(left, right int) bool {
		if deduped[left].LabelKind != deduped[right].LabelKind {
			return deduped[left].LabelKind < deduped[right].LabelKind
		}
		if deduped[left].Category != deduped[right].Category {
			return deduped[left].Category < deduped[right].Category
		}
		return deduped[left].ID > deduped[right].ID
	})

	return stratifiedReplaySample(deduped, limit), nil
}

func buildReplayCase(row db.ReplayBenchmarkCandidate) (Case, bool) {
	request := api.SuggestRequest{
		SessionID:    "bench-replay",
		Buffer:       row.Buffer,
		CWD:          row.CWD,
		RepoRoot:     row.RepoRoot,
		Branch:       row.Branch,
		LastExitCode: row.LastExitCode,
	}
	if contextRequest, recentCommands, ok := decodeReplayRequest(row.StructuredContextJSON); ok {
		request = contextRequest
		request.SessionID = "bench-replay"
		request.RecentCommands = recentCommands
	}

	labelKind := LabelKindPositive
	if row.QualityLabel == "bad" || row.FeedbackEvent == "rejected" {
		labelKind = LabelKindNegative
	}

	expected := strings.TrimSpace(row.AcceptedCommand)
	if expected == "" {
		expected = strings.TrimSpace(row.ActualCommand)
	}
	if expected == "" && row.QualityLabel == "good" {
		expected = strings.TrimSpace(row.SuggestionText)
	}

	negative := ""
	if labelKind == LabelKindNegative {
		negative = strings.TrimSpace(row.SuggestionText)
		if negative == "" {
			return Case{}, false
		}
	}
	if labelKind == LabelKindPositive && expected == "" {
		return Case{}, false
	}

	return Case{
		ID:        replayCaseID(row.SuggestionID),
		Name:      replayCaseName(row.Buffer, expected, negative),
		Category:  categorizeCommand(request.Buffer, expected, negative),
		Tags:      replayTags(labelKind, request.Buffer, row.Source),
		LabelKind: labelKind,
		Request:   request,
		Expected:  expected,
		Negative:  negative,
		Origin:    "replay",
		ReplaySource: ReplaySource{
			SuggestionID: row.SuggestionID,
			EventType:    row.FeedbackEvent,
			QualityLabel: row.QualityLabel,
		},
	}, true
}

func decodeReplayRequest(payload string) (api.SuggestRequest, []string, bool) {
	if strings.TrimSpace(payload) == "" {
		return api.SuggestRequest{}, nil, false
	}
	var parsed struct {
		Request struct {
			SessionID    string `json:"sessionId"`
			Buffer       string `json:"buffer"`
			CWD          string `json:"cwd"`
			RepoRoot     string `json:"repoRoot"`
			Branch       string `json:"branch"`
			LastExitCode int    `json:"lastExitCode"`
			Strategy     string `json:"strategy"`
		} `json:"request"`
		RecentCommands []string `json:"recentCommands"`
	}
	if err := json.Unmarshal([]byte(payload), &parsed); err != nil {
		return api.SuggestRequest{}, nil, false
	}

	return api.SuggestRequest{
		SessionID:      parsed.Request.SessionID,
		Buffer:         parsed.Request.Buffer,
		CWD:            parsed.Request.CWD,
		RepoRoot:       parsed.Request.RepoRoot,
		Branch:         parsed.Request.Branch,
		LastExitCode:   parsed.Request.LastExitCode,
		RecentCommands: append([]string(nil), parsed.RecentCommands...),
		Strategy:       parsed.Request.Strategy,
	}, append([]string(nil), parsed.RecentCommands...), true
}

func replayDedupKey(candidate Case) string {
	return strings.Join([]string{
		string(candidate.LabelKind),
		normalizeCommand(candidate.Request.Buffer),
		normalizeCommand(candidate.Expected),
		normalizeCommand(candidate.Negative),
		candidate.Category,
	}, "|")
}

func stratifiedReplaySample(cases []Case, limit int) []Case {
	if limit <= 0 || len(cases) <= limit {
		return cases
	}

	positives := make([]Case, 0, len(cases))
	negatives := make([]Case, 0, len(cases))
	for _, candidate := range cases {
		if candidate.LabelKind == LabelKindNegative {
			negatives = append(negatives, candidate)
		} else {
			positives = append(positives, candidate)
		}
	}

	targetNegative := min(limit/2, len(negatives))
	targetPositive := min(limit-targetNegative, len(positives))
	if targetPositive+targetNegative < limit {
		remaining := limit - targetPositive - targetNegative
		if len(positives)-targetPositive >= remaining {
			targetPositive += remaining
		} else {
			targetNegative = min(limit-targetPositive, len(negatives))
		}
	}

	result := takeRoundRobinByCategory(positives, targetPositive)
	result = append(result, takeRoundRobinByCategory(negatives, targetNegative)...)
	sort.SliceStable(result, func(left, right int) bool {
		if result[left].LabelKind != result[right].LabelKind {
			return result[left].LabelKind < result[right].LabelKind
		}
		if result[left].Category != result[right].Category {
			return result[left].Category < result[right].Category
		}
		return result[left].ID < result[right].ID
	})
	return result
}

func takeRoundRobinByCategory(values []Case, target int) []Case {
	if target <= 0 || len(values) == 0 {
		return nil
	}
	buckets := map[string][]Case{}
	var keys []string
	for _, value := range values {
		if _, exists := buckets[value.Category]; !exists {
			keys = append(keys, value.Category)
		}
		buckets[value.Category] = append(buckets[value.Category], value)
	}
	sort.Strings(keys)
	result := make([]Case, 0, min(target, len(values)))
	for len(result) < target {
		progressed := false
		for _, key := range keys {
			if len(result) >= target {
				break
			}
			bucket := buckets[key]
			if len(bucket) == 0 {
				continue
			}
			result = append(result, bucket[0])
			buckets[key] = bucket[1:]
			progressed = true
		}
		if !progressed {
			break
		}
	}
	return result
}

func replayCaseID(id int64) string {
	return fmt.Sprintf("replay-%d", id)
}

func replayCaseName(buffer, expected, negative string) string {
	switch {
	case strings.TrimSpace(expected) != "":
		return strings.TrimSpace(buffer) + " -> " + strings.TrimSpace(expected)
	case strings.TrimSpace(negative) != "":
		return strings.TrimSpace(buffer) + " avoid " + strings.TrimSpace(negative)
	default:
		return strings.TrimSpace(buffer)
	}
}

func replayTags(labelKind LabelKind, buffer, source string) []string {
	tags := []string{"replay", string(labelKind)}
	if source = strings.TrimSpace(source); source != "" {
		tags = append(tags, source)
	}
	category := categorizeCommand(buffer, "", "")
	if category != "" {
		tags = append(tags, category)
	}
	return tags
}

func categorizeCommand(buffer, expected, negative string) string {
	command := strings.TrimSpace(expected)
	if command == "" {
		command = strings.TrimSpace(negative)
	}
	if command == "" {
		command = strings.TrimSpace(buffer)
	}
	switch {
	case command == "":
		return "empty-buffer"
	case strings.HasPrefix(command, "git "):
		return "git"
	case strings.HasPrefix(command, "cd "):
		return "nav"
	case strings.HasPrefix(command, "npm ") || strings.HasPrefix(command, "pnpm ") || strings.HasPrefix(command, "yarn ") || strings.HasPrefix(command, "bun "):
		return "package-manager"
	case strings.HasPrefix(command, "docker ") || strings.HasPrefix(command, "kubectl ") || strings.HasPrefix(command, "gcloud ") || strings.HasPrefix(command, "terraform ") || strings.HasPrefix(command, "aws "):
		return "infra"
	case strings.HasPrefix(command, "go test") || strings.HasPrefix(command, "go run") || strings.HasPrefix(command, "cargo test") || strings.HasPrefix(command, "pytest") || strings.Contains(command, " test"):
		return "build-test"
	default:
		return "repo-specific"
	}
}
