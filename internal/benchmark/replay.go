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

func LoadReplayCases(ctx context.Context, store *db.Store, limit int) ([]Case, error) {
	examples, err := LoadEvalExamples(ctx, store, defaultReplayQueryLimit)
	if err != nil {
		return nil, err
	}

	cases := make([]Case, 0, len(examples))
	for _, example := range examples {
		replayCase, ok := buildReplayCase(example)
		if !ok {
			continue
		}
		cases = append(cases, replayCase)
	}

	sort.SliceStable(cases, func(left, right int) bool {
		if cases[left].LabelKind != cases[right].LabelKind {
			return cases[left].LabelKind < cases[right].LabelKind
		}
		if cases[left].Category != cases[right].Category {
			return cases[left].Category < cases[right].Category
		}
		return cases[left].ID > cases[right].ID
	})

	return stratifiedReplaySample(cases, limit), nil
}

func buildReplayCase(example EvalExample) (Case, bool) {
	request := example.Request
	if request.SessionID == "" {
		request.SessionID = "bench-replay"
	}
	if example.LabelKind == LabelKindPositive && strings.TrimSpace(example.ExpectedCommand) == "" {
		return Case{}, false
	}
	if example.LabelKind == LabelKindNegative && strings.TrimSpace(example.NegativeCommand) == "" {
		return Case{}, false
	}

	return Case{
		ID:           example.ID,
		Name:         replayCaseName(request.Buffer, example.ExpectedCommand, example.NegativeCommand),
		Category:     example.CommandFamily,
		Tags:         replayTags(example.LabelKind, request.Buffer, example.SuggestionSource),
		LabelKind:    example.LabelKind,
		Request:      request,
		Expected:     example.ExpectedCommand,
		Negative:     example.NegativeCommand,
		Origin:       "replay",
		ReplaySource: example.ReplaySource,
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
