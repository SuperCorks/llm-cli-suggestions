package main

import (
	"testing"

	"github.com/SuperCorks/llm-cli-suggestions/internal/benchmark"
)

func TestParseCommandDefaultsToStatic(t *testing.T) {
	command, args := parseCommand(nil)
	if command != "static" {
		t.Fatalf("expected static default, got %q", command)
	}
	if len(args) != 0 {
		t.Fatalf("expected no args, got %v", args)
	}
}

func TestParseCommandTreatsFlagsAsStatic(t *testing.T) {
	command, args := parseCommand([]string{"-models", "qwen3"})
	if command != "static" {
		t.Fatalf("expected static for flag-only invocation, got %q", command)
	}
	if len(args) != 2 {
		t.Fatalf("expected original args to remain intact, got %v", args)
	}
}

func TestParseTimingProtocol(t *testing.T) {
	tests := []struct {
		input    string
		expected benchmark.TimingProtocol
	}{
		{input: "", expected: benchmark.TimingProtocolFull},
		{input: "full", expected: benchmark.TimingProtocolFull},
		{input: "cold", expected: benchmark.TimingProtocolColdOnly},
		{input: "hot_only", expected: benchmark.TimingProtocolHotOnly},
		{input: "mixed", expected: benchmark.TimingProtocolMixed},
	}

	for _, test := range tests {
		actual, err := parseTimingProtocol(test.input)
		if err != nil {
			t.Fatalf("parseTimingProtocol(%q): %v", test.input, err)
		}
		if actual != test.expected {
			t.Fatalf("parseTimingProtocol(%q) = %q, want %q", test.input, actual, test.expected)
		}
	}
}

func TestParseTimingProtocolRejectsUnknownValues(t *testing.T) {
	if _, err := parseTimingProtocol("mystery"); err == nil {
		t.Fatal("expected parseTimingProtocol to reject unknown values")
	}
}

func TestParseCommandRecognizesExportEval(t *testing.T) {
	command, args := parseCommand([]string{"export-eval", "--limit", "10"})
	if command != "export-eval" {
		t.Fatalf("expected export-eval command, got %q", command)
	}
	if len(args) != 2 {
		t.Fatalf("expected export-eval args to be preserved, got %v", args)
	}
}

func TestParseEvalConfidence(t *testing.T) {
	tests := []struct {
		input    string
		expected benchmark.EvalConfidence
	}{
		{input: "", expected: benchmark.EvalConfidenceStrong},
		{input: "strong", expected: benchmark.EvalConfidenceStrong},
		{input: "medium", expected: benchmark.EvalConfidenceMedium},
	}

	for _, test := range tests {
		actual, err := parseEvalConfidence(test.input)
		if err != nil {
			t.Fatalf("parseEvalConfidence(%q): %v", test.input, err)
		}
		if actual != test.expected {
			t.Fatalf("parseEvalConfidence(%q) = %q, want %q", test.input, actual, test.expected)
		}
	}
}

func TestParseEvalConfidenceRejectsUnknownValues(t *testing.T) {
	if _, err := parseEvalConfidence("low"); err == nil {
		t.Fatal("expected parseEvalConfidence to reject unknown values")
	}
}

func TestParseEvalOutputFormat(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{input: "", expected: "jsonl"},
		{input: "jsonl", expected: "jsonl"},
		{input: "json", expected: "json"},
	}

	for _, test := range tests {
		actual, err := parseEvalOutputFormat(test.input)
		if err != nil {
			t.Fatalf("parseEvalOutputFormat(%q): %v", test.input, err)
		}
		if actual != test.expected {
			t.Fatalf("parseEvalOutputFormat(%q) = %q, want %q", test.input, actual, test.expected)
		}
	}
}

func TestParseEvalOutputFormatRejectsUnknownValues(t *testing.T) {
	if _, err := parseEvalOutputFormat("tsv"); err == nil {
		t.Fatal("expected parseEvalOutputFormat to reject unknown values")
	}
}
