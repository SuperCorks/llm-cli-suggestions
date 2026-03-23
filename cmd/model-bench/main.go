package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/SuperCorks/llm-cli-suggestions/internal/api"
	"github.com/SuperCorks/llm-cli-suggestions/internal/db"
	"github.com/SuperCorks/llm-cli-suggestions/internal/engine"
	"github.com/SuperCorks/llm-cli-suggestions/internal/model/ollama"
)

type benchmarkCase struct {
	Name       string
	Request    api.SuggestRequest
	Acceptable []string
}

type runResult struct {
	Model       string `json:"model"`
	CaseName    string `json:"case_name"`
	Run         int    `json:"run"`
	LatencyMS   int64  `json:"latency_ms"`
	Suggestion  string `json:"suggestion"`
	ValidPrefix bool   `json:"valid_prefix"`
	Accepted    bool   `json:"accepted"`
	Error       string `json:"error,omitempty"`
}

type suggestClient interface {
	Suggest(ctx context.Context, prompt string) (string, error)
}

type benchmarkConfig struct {
	models    []string
	repeat    int
	timeout   time.Duration
	failFast  bool
	newClient func(modelName string) suggestClient
	cases     []benchmarkCase
}

func main() {
	modelsFlag := flag.String("models", "llama3.2:latest", "comma-separated list of models to benchmark")
	baseURL := flag.String("model-url", "http://127.0.0.1:11434", "local model base URL")
	repeat := flag.Int("repeat", 1, "runs per test case")
	timeoutMS := flag.Int("timeout-ms", 5000, "timeout per model request in milliseconds")
	failFast := flag.Bool("fail-fast", true, "stop the benchmark run after the first model request error")
	outputJSON := flag.String("output-json", "", "optional path to write raw benchmark results as json")
	flag.Parse()

	models := splitCSV(*modelsFlag)
	if len(models) == 0 {
		fatalf("no models provided")
	}

	results, runErr := runBenchmarks(benchmarkConfig{
		models:   models,
		repeat:   *repeat,
		timeout:  time.Duration(*timeoutMS) * time.Millisecond,
		failFast: *failFast,
		newClient: func(modelName string) suggestClient {
			return ollama.New(*baseURL, modelName, "")
		},
	})

	fmt.Println()
	printSummary(results)

	if *outputJSON != "" {
		if err := writeJSON(*outputJSON, results); err != nil {
			fatalf("write benchmark results: %v", err)
		}
		fmt.Printf("\nWrote raw results to %s\n", *outputJSON)
	}

	if runErr != nil {
		fatalf("benchmark failed early: %v", runErr)
	}
}

func runBenchmarks(config benchmarkConfig) ([]runResult, error) {
	cases := config.cases
	if len(cases) == 0 {
		cases = benchmarkCases()
	}

	results := make([]runResult, 0, len(config.models)*len(cases)*config.repeat)
	fmt.Printf("Benchmarking %d model(s) across %d case(s), repeat=%d\n", len(config.models), len(cases), config.repeat)

	for _, modelName := range config.models {
		client := config.newClient(modelName)
		for _, testCase := range cases {
			for run := 1; run <= config.repeat; run++ {
				prompt := engine.BuildPrompt(
					"",
					testCase.Request,
					testCase.Request.RecentCommands,
					db.CommandContext{},
					nil,
					nil,
					api.InspectRetrievedContext{},
				)
				ctx, cancel := context.WithTimeout(context.Background(), config.timeout)
				startedAt := time.Now()
				raw, err := client.Suggest(ctx, prompt)
				cancel()

				result := runResult{
					Model:     modelName,
					CaseName:  testCase.Name,
					Run:       run,
					LatencyMS: time.Since(startedAt).Milliseconds(),
				}
				if err != nil {
					result.Error = err.Error()
				} else {
					result.Suggestion = engine.CleanSuggestion(testCase.Request.Buffer, raw)
					result.ValidPrefix = strings.HasPrefix(result.Suggestion, testCase.Request.Buffer) && result.Suggestion != testCase.Request.Buffer
					result.Accepted = containsExact(testCase.Acceptable, result.Suggestion)
				}

				results = append(results, result)
				printRun(result)

				if result.Error != "" && config.failFast {
					return results, fmt.Errorf(
						"model %s failed on %s run %d: %s",
						modelName,
						testCase.Name,
						run,
						result.Error,
					)
				}
			}
		}
	}

	return results, nil
}

func benchmarkCases() []benchmarkCase {
	return []benchmarkCase{
		{
			Name: "git_status_after_repo_navigation",
			Request: api.SuggestRequest{
				SessionID:    "bench",
				Buffer:       "git st",
				CWD:          "/Users/example/projects/llm-cli-suggestions",
				RepoRoot:     "/Users/example/projects/llm-cli-suggestions",
				Branch:       "main",
				LastExitCode: 0,
				RecentCommands: []string{
					"cd /Users/example/projects/llm-cli-suggestions",
					"git checkout main",
					"git pull",
					"go test ./...",
				},
			},
			Acceptable: []string{"git status", "git stash"},
		},
		{
			Name: "npm_dev_server",
			Request: api.SuggestRequest{
				SessionID:    "bench",
				Buffer:       "npm run d",
				CWD:          "/Users/example/app",
				RepoRoot:     "/Users/example/app",
				Branch:       "feature/autocomplete",
				LastExitCode: 0,
				RecentCommands: []string{
					"npm install",
					"npm test",
					"npm run lint",
				},
			},
			Acceptable: []string{"npm run dev"},
		},
		{
			Name: "docker_compose_logs",
			Request: api.SuggestRequest{
				SessionID:    "bench",
				Buffer:       "docker comp",
				CWD:          "/Users/example/services",
				RepoRoot:     "/Users/example/services",
				Branch:       "main",
				LastExitCode: 1,
				RecentCommands: []string{
					"docker compose up -d",
					"docker compose ps",
					"docker compose restart web",
				},
			},
			Acceptable: []string{"docker compose logs -f", "docker compose up -d", "docker compose ps"},
		},
		{
			Name: "kubectl_get_pods",
			Request: api.SuggestRequest{
				SessionID:    "bench",
				Buffer:       "kubectl get p",
				CWD:          "/Users/example",
				RepoRoot:     "",
				Branch:       "",
				LastExitCode: 0,
				RecentCommands: []string{
					"kubectl config use-context prod",
					"kubectl get nodes",
					"kubectl describe pod api-123",
				},
			},
			Acceptable: []string{"kubectl get pods"},
		},
		{
			Name: "git_checkout_branch",
			Request: api.SuggestRequest{
				SessionID:    "bench",
				Buffer:       "git chec",
				CWD:          "/Users/example/projects/llm-cli-suggestions",
				RepoRoot:     "/Users/example/projects/llm-cli-suggestions",
				Branch:       "main",
				LastExitCode: 0,
				RecentCommands: []string{
					"git branch",
					"git fetch origin",
					"git checkout -b spike/autocomplete",
				},
			},
			Acceptable: []string{"git checkout", "git checkout -b spike/autocomplete"},
		},
		{
			Name: "git_log_oneline_recent",
			Request: api.SuggestRequest{
				SessionID:    "bench",
				Buffer:       "git log --oneline -",
				CWD:          "/Users/example/projects/gleamery",
				RepoRoot:     "/Users/example/projects/gleamery",
				Branch:       "develop",
				LastExitCode: 0,
				RecentCommands: []string{
					"git status",
					"git checkout develop",
					"git pull --rebase",
				},
			},
			Acceptable: []string{"git log --oneline -5", "git log --oneline -10"},
		},
		{
			Name: "gcloud_auth_list",
			Request: api.SuggestRequest{
				SessionID:    "bench",
				Buffer:       "gcloud auth l",
				CWD:          "/Users/example",
				RepoRoot:     "",
				Branch:       "",
				LastExitCode: 0,
				RecentCommands: []string{
					"gcloud auth",
					"gcloud list",
					"gcloud config set project my-project-1478832460965",
				},
			},
			Acceptable: []string{"gcloud auth list"},
		},
		{
			Name: "envpull_push",
			Request: api.SuggestRequest{
				SessionID:    "bench",
				Buffer:       "envpull p",
				CWD:          "/Users/example/projects/gleamery/gleamery-appointments",
				RepoRoot:     "/Users/example/projects/gleamery/gleamery-appointments",
				Branch:       "main",
				LastExitCode: 0,
				RecentCommands: []string{
					"envpull init",
					"envpull ls",
					"envpull help",
				},
			},
			Acceptable: []string{"envpull push .env.prod.local .env.sandbox.local"},
		},
		{
			Name: "gswitch_private_project",
			Request: api.SuggestRequest{
				SessionID:    "bench",
				Buffer:       "gswitch new p",
				CWD:          "/Users/example/projects/blvd-events-pipelines",
				RepoRoot:     "/Users/example/projects/blvd-events-pipelines",
				Branch:       "main",
				LastExitCode: 0,
				RecentCommands: []string{
					"npx gswitch new peachy --private",
					"gswitch new rk",
					"npm login",
				},
			},
			Acceptable: []string{"gswitch new peachy --private"},
		},
	}
}

func printRun(result runResult) {
	status := "ok"
	if result.Error != "" {
		status = "error"
	}
	fmt.Printf("[%s] model=%s case=%s run=%d latency=%dms valid=%t accepted=%t suggestion=%q error=%q\n",
		status,
		result.Model,
		result.CaseName,
		result.Run,
		result.LatencyMS,
		result.ValidPrefix,
		result.Accepted,
		result.Suggestion,
		result.Error,
	)
}

func printSummary(results []runResult) {
	type summary struct {
		Count         int
		Errors        int
		ValidCount    int
		AcceptedCount int
		LatencyTotal  int64
	}

	summaries := map[string]*summary{}
	for _, result := range results {
		entry := summaries[result.Model]
		if entry == nil {
			entry = &summary{}
			summaries[result.Model] = entry
		}
		entry.Count++
		entry.LatencyTotal += result.LatencyMS
		if result.Error != "" {
			entry.Errors++
		}
		if result.ValidPrefix {
			entry.ValidCount++
		}
		if result.Accepted {
			entry.AcceptedCount++
		}
	}

	models := make([]string, 0, len(summaries))
	for model := range summaries {
		models = append(models, model)
	}
	sort.Strings(models)

	fmt.Println("Summary")
	for _, model := range models {
		entry := summaries[model]
		averageLatency := int64(0)
		if entry.Count > 0 {
			averageLatency = entry.LatencyTotal / int64(entry.Count)
		}
		fmt.Printf(
			"- %s: avg_latency=%dms valid=%d/%d accepted=%d/%d errors=%d\n",
			model,
			averageLatency,
			entry.ValidCount,
			entry.Count,
			entry.AcceptedCount,
			entry.Count,
			entry.Errors,
		)
	}
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			result = append(result, part)
		}
	}
	return result
}

func containsExact(values []string, target string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == strings.TrimSpace(target) {
			return true
		}
	}
	return false
}

func writeJSON(path string, payload any) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	return encoder.Encode(payload)
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
