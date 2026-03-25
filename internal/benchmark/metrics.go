package benchmark

import (
	"math"
	"sort"
	"strings"
	"unicode/utf8"
)

func normalizeCommand(value string) string {
	return strings.TrimSpace(value)
}

func matchesExpected(candidate string, expected string, alternatives []string) (bool, bool) {
	candidate = normalizeCommand(candidate)
	if candidate == "" {
		return false, false
	}
	if normalizeCommand(expected) != "" && candidate == normalizeCommand(expected) {
		return true, false
	}
	for _, alt := range alternatives {
		if candidate == normalizeCommand(alt) {
			return false, true
		}
	}
	return false, false
}

func validPrefix(prefix, suggestion string) bool {
	prefix = strings.TrimSpace(prefix)
	suggestion = strings.TrimSpace(suggestion)
	if suggestion == "" {
		return false
	}
	if prefix == "" {
		return suggestion != ""
	}
	return strings.HasPrefix(suggestion, prefix) && suggestion != prefix
}

func candidateHitAt3(candidates []CandidatePreview, expected string, alternatives []string) bool {
	for _, candidate := range candidates {
		if exact, alt := matchesExpected(candidate.Command, expected, alternatives); exact || alt {
			return true
		}
	}
	return false
}

func computeCharsSavedRatio(buffer, expected string, matched bool) float64 {
	if !matched {
		return 0
	}
	total := utf8.RuneCountInString(strings.TrimSpace(expected))
	if total <= 0 {
		return 0
	}
	typed := utf8.RuneCountInString(strings.TrimSpace(buffer))
	if typed >= total {
		return 0
	}
	return float64(total-typed) / float64(total)
}

func editDistance(left, right string) int {
	leftRunes := []rune(left)
	rightRunes := []rune(right)
	if len(leftRunes) == 0 {
		return len(rightRunes)
	}
	if len(rightRunes) == 0 {
		return len(leftRunes)
	}

	previous := make([]int, len(rightRunes)+1)
	for index := range previous {
		previous[index] = index
	}

	for i := 1; i <= len(leftRunes); i++ {
		current := make([]int, len(rightRunes)+1)
		current[0] = i
		for j := 1; j <= len(rightRunes); j++ {
			cost := 0
			if leftRunes[i-1] != rightRunes[j-1] {
				cost = 1
			}
			current[j] = min3(
				current[j-1]+1,
				previous[j]+1,
				previous[j-1]+cost,
			)
		}
		previous = current
	}
	return previous[len(rightRunes)]
}

func min3(a, b, c int) int {
	if a <= b && a <= c {
		return a
	}
	if b <= c {
		return b
	}
	return c
}

func min(a, b int) int {
	if a <= b {
		return a
	}
	return b
}

func average(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sum := 0.0
	for _, value := range values {
		sum += value
	}
	return sum / float64(len(values))
}

func percentile(values []float64, ratio float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	index := int(math.Ceil(float64(len(sorted))*ratio)) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func maxFloat(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	maxValue := values[0]
	for _, value := range values[1:] {
		if value > maxValue {
			maxValue = value
		}
	}
	return maxValue
}

func toFloat64(values []int64) []float64 {
	result := make([]float64, 0, len(values))
	for _, value := range values {
		result = append(result, float64(value))
	}
	return result
}

func summarizeLatency(values []int64) LatencyStats {
	floatValues := toFloat64(values)
	return LatencyStats{
		Count:  len(values),
		Mean:   average(floatValues),
		Median: percentile(floatValues, 0.5),
		P90:    percentile(floatValues, 0.9),
		P95:    percentile(floatValues, 0.95),
		Max:    maxFloat(floatValues),
	}
}
