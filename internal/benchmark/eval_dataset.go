package benchmark

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/SuperCorks/llm-cli-suggestions/internal/api"
	"github.com/SuperCorks/llm-cli-suggestions/internal/db"
)

const defaultReplayQueryLimit = 1000

func LoadEvalExamples(ctx context.Context, store *db.Store, limit int) ([]EvalExample, error) {
	rows, err := store.ListReplayBenchmarkCandidates(ctx, replayQueryLimit(limit))
	if err != nil {
		return nil, err
	}

	deduped := make([]EvalExample, 0, len(rows))
	seen := map[string]struct{}{}
	for _, row := range rows {
		example, ok := buildEvalExample(row)
		if !ok {
			continue
		}
		key := evalDedupKey(example)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		deduped = append(deduped, example)
	}

	sort.SliceStable(deduped, func(left, right int) bool {
		if deduped[left].LabelKind != deduped[right].LabelKind {
			return deduped[left].LabelKind < deduped[right].LabelKind
		}
		if confidenceRank(deduped[left].Confidence) != confidenceRank(deduped[right].Confidence) {
			return confidenceRank(deduped[left].Confidence) > confidenceRank(deduped[right].Confidence)
		}
		if deduped[left].CommandFamily != deduped[right].CommandFamily {
			return deduped[left].CommandFamily < deduped[right].CommandFamily
		}
		if deduped[left].RepoName != deduped[right].RepoName {
			return deduped[left].RepoName < deduped[right].RepoName
		}
		return deduped[left].SuggestionID > deduped[right].SuggestionID
	})

	if limit > 0 && len(deduped) > limit {
		return deduped[:limit], nil
	}
	return deduped, nil
}

func FilterEvalExamplesByConfidence(values []EvalExample, minimum EvalConfidence) []EvalExample {
	if minimum == "" {
		minimum = EvalConfidenceMedium
	}
	filtered := make([]EvalExample, 0, len(values))
	for _, value := range values {
		if confidenceRank(value.Confidence) >= confidenceRank(minimum) {
			filtered = append(filtered, value)
		}
	}
	return filtered
}

func EncodeEvalDataset(dataset EvalDataset) ([]byte, error) {
	return json.MarshalIndent(dataset, "", "  ")
}

func EncodeEvalDatasetJSONL(examples []EvalExample) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	for _, example := range examples {
		if err := encoder.Encode(example); err != nil {
			return nil, fmt.Errorf("encode eval example %s: %w", example.ID, err)
		}
	}
	return buffer.Bytes(), nil
}

func LoadEvalDataset(path string) (EvalDataset, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return EvalDataset{}, fmt.Errorf("read eval dataset: %w", err)
	}
	return DecodeEvalDataset(payload)
}

func DecodeEvalDataset(payload []byte) (EvalDataset, error) {
	var wrapped EvalDataset
	if err := json.Unmarshal(payload, &wrapped); err == nil && wrapped.SchemaVersion > 0 {
		return wrapped, nil
	}

	lines := strings.Split(string(payload), "\n")
	examples := make([]EvalExample, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var example EvalExample
		if err := json.Unmarshal([]byte(line), &example); err != nil {
			return EvalDataset{}, fmt.Errorf("decode eval dataset jsonl: %w", err)
		}
		examples = append(examples, example)
	}
	return EvalDataset{
		SchemaVersion: 1,
		Examples:      examples,
	}, nil
}

func EvalExamplesToCases(values []EvalExample) []Case {
	cases := make([]Case, 0, len(values))
	for _, example := range values {
		replayCase, ok := buildReplayCase(example)
		if !ok {
			continue
		}
		replayCase.Origin = "eval"
		cases = append(cases, replayCase)
	}
	return cases
}

func buildEvalExample(row db.ReplayBenchmarkCandidate) (EvalExample, bool) {
	request := api.SuggestRequest{
		SessionID:    "bench-replay",
		Buffer:       row.Buffer,
		CWD:          row.CWD,
		RepoRoot:     row.RepoRoot,
		Branch:       row.Branch,
		LastExitCode: row.LastExitCode,
	}
	if contextRequest, _, ok := decodeReplayRequest(row.StructuredContextJSON); ok {
		request = contextRequest
		request.SessionID = "bench-replay"
	}

	labelKind, outcome, confidence, expected, negative, ok := classifyEvalCandidate(row)
	if !ok {
		return EvalExample{}, false
	}

	category := categorizeCommand(request.Buffer, expected, negative)
	repoRoot := strings.TrimSpace(request.RepoRoot)
	if repoRoot == "" {
		repoRoot = strings.TrimSpace(row.RepoRoot)
	}

	return EvalExample{
		ID:                    replayCaseID(row.SuggestionID),
		SuggestionID:          row.SuggestionID,
		CreatedAtMS:           row.CreatedAtMS,
		LabelKind:             labelKind,
		Outcome:               outcome,
		Confidence:            confidence,
		CommandFamily:         category,
		RepoRoot:              repoRoot,
		RepoName:              repoName(repoRoot),
		SuggestionSource:      strings.TrimSpace(row.Source),
		ModelName:             strings.TrimSpace(row.ModelName),
		Request:               request,
		PromptText:            strings.TrimSpace(row.PromptText),
		StructuredContextJSON: strings.TrimSpace(row.StructuredContextJSON),
		SuggestedCommand:      strings.TrimSpace(row.SuggestionText),
		ExpectedCommand:       expected,
		NegativeCommand:       negative,
		AcceptedCommand:       strings.TrimSpace(row.AcceptedCommand),
		ActualCommand:         strings.TrimSpace(row.ActualCommand),
		ReplaySource: ReplaySource{
			SuggestionID: row.SuggestionID,
			EventType:    strings.TrimSpace(row.FeedbackEvent),
			QualityLabel: strings.TrimSpace(row.QualityLabel),
		},
	}, true
}

func classifyEvalCandidate(row db.ReplayBenchmarkCandidate) (LabelKind, EvalOutcome, EvalConfidence, string, string, bool) {
	suggestion := strings.TrimSpace(row.SuggestionText)
	accepted := strings.TrimSpace(row.AcceptedCommand)
	actual := strings.TrimSpace(row.ActualCommand)
	quality := strings.TrimSpace(row.QualityLabel)
	feedback := strings.TrimSpace(row.FeedbackEvent)

	switch quality {
	case "good":
		expected := accepted
		if expected == "" {
			expected = actual
		}
		if expected == "" {
			expected = suggestion
		}
		if expected == "" {
			return "", "", "", "", "", false
		}
		return LabelKindPositive, EvalOutcomeReviewedGood, EvalConfidenceStrong, expected, "", true
	case "bad":
		if suggestion == "" {
			return "", "", "", "", "", false
		}
		return LabelKindNegative, EvalOutcomeReviewedBad, EvalConfidenceStrong, "", suggestion, true
	}

	switch feedback {
	case "rejected":
		if suggestion == "" {
			return "", "", "", "", "", false
		}
		return LabelKindNegative, EvalOutcomeRejected, EvalConfidenceStrong, "", suggestion, true
	case "executed_unchanged":
		expected := actual
		if expected == "" {
			expected = accepted
		}
		if expected == "" {
			expected = suggestion
		}
		if expected == "" {
			return "", "", "", "", "", false
		}
		return LabelKindPositive, EvalOutcomeExecutedUnchanged, EvalConfidenceStrong, expected, "", true
	case "executed_edited":
		expected := actual
		if expected == "" {
			return "", "", "", "", "", false
		}
		return LabelKindPositive, EvalOutcomeExecutedEdited, EvalConfidenceMedium, expected, "", true
	case "accepted":
		expected := accepted
		if expected == "" {
			expected = suggestion
		}
		if expected == "" {
			return "", "", "", "", "", false
		}
		// Accepted suggestions are useful positives, but the current logging model
		// cannot yet distinguish unchanged execution from later manual edits.
		return LabelKindPositive, EvalOutcomeAccepted, EvalConfidenceMedium, expected, "", true
	default:
		return "", "", "", "", "", false
	}
}

func evalDedupKey(example EvalExample) string {
	return strings.Join([]string{
		string(example.LabelKind),
		string(example.Outcome),
		normalizeCommand(example.Request.Buffer),
		normalizeCommand(example.ExpectedCommand),
		normalizeCommand(example.NegativeCommand),
		example.CommandFamily,
		strings.TrimSpace(example.RepoRoot),
	}, "|")
}

func replayQueryLimit(limit int) int {
	if limit <= 0 {
		return defaultReplayQueryLimit
	}
	return max(limit, defaultReplayQueryLimit)
}

func repoName(repoRoot string) string {
	repoRoot = strings.TrimSpace(repoRoot)
	if repoRoot == "" {
		return ""
	}
	name := strings.TrimSpace(filepath.Base(repoRoot))
	if name == "." || name == string(filepath.Separator) {
		return ""
	}
	return name
}

func confidenceRank(value EvalConfidence) int {
	switch value {
	case EvalConfidenceStrong:
		return 2
	case EvalConfidenceMedium:
		return 1
	default:
		return 0
	}
}
