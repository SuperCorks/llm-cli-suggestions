package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/SuperCorks/llm-cli-suggestions/internal/benchmark"
	"github.com/SuperCorks/llm-cli-suggestions/internal/config"
	"github.com/SuperCorks/llm-cli-suggestions/internal/db"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fatalf("load config: %v", err)
	}

	command, args := parseCommand(os.Args[1:])
	switch command {
	case "static":
		runBenchCommand(benchmark.TrackStatic, benchmark.SurfaceEndToEnd, cfg, args)
	case "replay":
		runBenchCommand(benchmark.TrackReplay, benchmark.SurfaceEndToEnd, cfg, args)
	case "raw":
		runBenchCommand(benchmark.TrackRaw, benchmark.SurfaceRawModel, cfg, args)
	case "compare":
		runCompareCommand(args)
	case "mine-static":
		runMineStaticCommand(cfg, args)
	default:
		fatalf("unknown subcommand %q", command)
	}
}

func parseCommand(args []string) (string, []string) {
	if len(args) == 0 {
		return "static", nil
	}
	switch args[0] {
	case "static", "replay", "raw", "compare", "mine-static":
		return args[0], args[1:]
	default:
		if strings.HasPrefix(args[0], "-") {
			return "static", args
		}
		return args[0], args[1:]
	}
}

func runBenchCommand(track benchmark.Track, surface benchmark.Surface, runtime config.Config, args []string) {
	flags := flag.NewFlagSet(string(track), flag.ExitOnError)
	modelsFlag := flags.String("models", runtime.ModelName, "comma-separated list of models to benchmark")
	suiteFlag := flags.String("suite", defaultSuiteName(track), "benchmark suite name")
	repeatFlag := flags.Int("repeat", 1, "runs per test case")
	timeoutMSFlag := flags.Int("timeout-ms", 5000, "timeout per request in milliseconds")
	failFastFlag := flags.Bool("fail-fast", true, "stop after the first benchmark error")
	outputJSONFlag := flags.String("output-json", "", "optional path to write the benchmark artifact json")
	protocolFlag := flags.String("protocol", "full", "timing protocol: cold, hot, mixed, or full")
	strategyFlag := flags.String("strategy", runtime.SuggestStrategy, "suggest strategy for end-to-end benchmarks")
	modelURLFlag := flags.String("model-url", runtime.ModelBaseURL, "local model base URL")
	keepAliveFlag := flags.String("keep-alive", runtime.ModelKeepAlive, "ollama keep_alive value for mixed mode")
	dbPathFlag := flags.String("db-path", runtime.DBPath, "sqlite path for replay benchmarks and engine context")
	replayLimitFlag := flags.Int("sample-limit", 200, "maximum replay cases to sample")
	flags.Parse(args)

	models := splitCSV(*modelsFlag)
	if len(models) == 0 {
		fatalf("no models provided")
	}

	timingProtocol, err := parseTimingProtocol(*protocolFlag)
	if err != nil {
		fatalf("%v", err)
	}

	filtersJSON := ""
	if track == benchmark.TrackReplay {
		filtersJSON = fmt.Sprintf(`{"sample_limit":%d}`, max(1, *replayLimitFlag))
	}

	runConfig := benchmark.RunConfig{
		Track:           track,
		Surface:         surface,
		SuiteName:       strings.TrimSpace(*suiteFlag),
		Strategy:        config.NormalizeSuggestStrategy(*strategyFlag),
		TimingProtocol:  timingProtocol,
		Models:          models,
		RepeatCount:     max(1, *repeatFlag),
		Timeout:         time.Duration(max(500, *timeoutMSFlag)) * time.Millisecond,
		FailFast:        *failFastFlag,
		DBPath:          *dbPathFlag,
		ModelBaseURL:    *modelURLFlag,
		ModelKeepAlive:  *keepAliveFlag,
		ActiveModelName: runtime.ModelName,
		SystemPrompt:    runtime.SystemPromptStatic,
		ReplayLimit:     max(1, *replayLimitFlag),
		FiltersJSON:     filtersJSON,
	}

	var wroteIntro bool
	artifact, runErr := benchmark.Run(context.Background(), runConfig, func(update benchmark.Progress) {
		if !wroteIntro && update.Total > 0 {
			fmt.Printf(
				"Benchmarking track=%s surface=%s suite=%s models=%d cases=%d attempts=%d protocol=%s repeat=%d\n",
				runConfig.Track,
				runConfig.Surface,
				runConfig.SuiteName,
				len(runConfig.Models),
				update.Total/(len(runConfig.Models)*max(1, runConfig.RepeatCount)*len(timingPhasesForProtocol(runConfig.TimingProtocol))),
				update.Total,
				runConfig.TimingProtocol,
				runConfig.RepeatCount,
			)
			wroteIntro = true
		}
		if update.CurrentCase == "" {
			return
		}
		fmt.Printf(
			"[progress] completed=%d/%d model=%s case=%s run=%d phase=%s status=%s\n",
			update.Completed,
			update.Total,
			update.CurrentModel,
			update.CurrentCase,
			update.CurrentRun,
			update.CurrentPhase,
			update.Status,
		)
	})

	fmt.Println()
	printArtifactSummary(artifact)

	if outputPath := strings.TrimSpace(*outputJSONFlag); outputPath != "" {
		if err := writeArtifact(outputPath, artifact); err != nil {
			fatalf("write benchmark artifact: %v", err)
		}
		fmt.Printf("\nWrote benchmark artifact to %s\n", outputPath)
	}

	if runErr != nil {
		fatalf("benchmark failed early: %v", runErr)
	}
}

func runCompareCommand(args []string) {
	flags := flag.NewFlagSet("compare", flag.ExitOnError)
	artifactsFlag := flags.String("artifacts", "", "comma-separated artifact json paths")
	flags.Parse(args)

	paths := append(splitCSV(*artifactsFlag), flags.Args()...)
	if len(paths) == 0 {
		fatalf("no artifact paths provided")
	}

	type compareRow struct {
		Label string
		Run   benchmark.Artifact
	}
	rows := make([]compareRow, 0, len(paths))
	for _, path := range paths {
		artifact, err := readArtifact(path)
		if err != nil {
			fatalf("read artifact %s: %v", path, err)
		}
		rows = append(rows, compareRow{Label: filepath.Base(path), Run: artifact})
	}

	fmt.Println("Benchmark Comparison")
	for _, row := range rows {
		fmt.Printf(
			"- %s: track=%s suite=%s exact=%.0f%% avoid=%.0f%% valid=%.0f%% mean=%.0fms p95=%.0fms dataset=%d\n",
			row.Label,
			row.Run.Run.Track,
			row.Run.Run.SuiteName,
			row.Run.Summary.Overall.Quality.PositiveExactHitRate*100,
			row.Run.Summary.Overall.Quality.NegativeAvoidRate*100,
			row.Run.Summary.Overall.Quality.ValidWinnerRate*100,
			row.Run.Summary.Overall.Latency.Mean,
			row.Run.Summary.Overall.Latency.P95,
			row.Run.Run.DatasetSize,
		)
	}
}

func runMineStaticCommand(runtime config.Config, args []string) {
	flags := flag.NewFlagSet("mine-static", flag.ExitOnError)
	dbPathFlag := flags.String("db-path", runtime.DBPath, "sqlite path to mine")
	limitFlag := flags.Int("limit", 25, "number of replay cases to propose")
	outputFlag := flags.String("output-json", "", "optional path to write proposed fixture json")
	flags.Parse(args)

	store, err := db.NewStore(*dbPathFlag)
	if err != nil {
		fatalf("open store: %v", err)
	}
	defer store.Close()

	cases, err := benchmark.LoadReplayCases(context.Background(), store, max(1, *limitFlag))
	if err != nil {
		fatalf("load replay cases: %v", err)
	}
	for index := range cases {
		cases[index].Origin = "mined"
	}

	payload, err := benchmark.EncodeArtifact(benchmark.Artifact{
		SchemaVersion: 1,
		Cases:         cases,
	})
	if err != nil {
		fatalf("encode mined cases: %v", err)
	}
	if strings.TrimSpace(*outputFlag) != "" {
		if err := os.WriteFile(*outputFlag, payload, 0o644); err != nil {
			fatalf("write mined cases: %v", err)
		}
		fmt.Printf("Wrote mined cases to %s\n", *outputFlag)
		return
	}
	fmt.Println(string(payload))
}

func writeArtifact(path string, artifact benchmark.Artifact) error {
	payload, err := benchmark.EncodeArtifact(artifact)
	if err != nil {
		return err
	}
	return os.WriteFile(path, payload, 0o644)
}

func readArtifact(path string) (benchmark.Artifact, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return benchmark.Artifact{}, err
	}
	var artifact benchmark.Artifact
	if err := json.Unmarshal(payload, &artifact); err != nil {
		return benchmark.Artifact{}, err
	}
	return artifact, nil
}

func printArtifactSummary(artifact benchmark.Artifact) {
	fmt.Printf(
		"Summary track=%s surface=%s suite=%s dataset=%d exact=%.0f%% avoid=%.0f%% valid=%.0f%% mean=%.0fms p95=%.0fms\n",
		artifact.Run.Track,
		artifact.Run.Surface,
		artifact.Run.SuiteName,
		artifact.Run.DatasetSize,
		artifact.Summary.Overall.Quality.PositiveExactHitRate*100,
		artifact.Summary.Overall.Quality.NegativeAvoidRate*100,
		artifact.Summary.Overall.Quality.ValidWinnerRate*100,
		artifact.Summary.Overall.Latency.Mean,
		artifact.Summary.Overall.Latency.P95,
	)

	models := append([]benchmark.ModelSummary(nil), artifact.Summary.Models...)
	sort.Slice(models, func(left, right int) bool { return models[left].Model < models[right].Model })
	for _, summary := range models {
		fmt.Printf(
			"- %s: exact=%.0f%% avoid=%.0f%% valid=%.0f%% mean=%.0fms p95=%.0fms cold=%.0fms hot=%.0fms\n",
			summary.Model,
			summary.Overall.Quality.PositiveExactHitRate*100,
			summary.Overall.Quality.NegativeAvoidRate*100,
			summary.Overall.Quality.ValidWinnerRate*100,
			summary.Overall.Latency.Mean,
			summary.Overall.Latency.P95,
			summary.Cold.Latency.Mean,
			summary.Hot.Latency.Mean,
		)
	}
}

func parseTimingProtocol(value string) (benchmark.TimingProtocol, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "", "full":
		return benchmark.TimingProtocolFull, nil
	case "cold", "cold_only":
		return benchmark.TimingProtocolColdOnly, nil
	case "hot", "hot_only":
		return benchmark.TimingProtocolHotOnly, nil
	case "mixed":
		return benchmark.TimingProtocolMixed, nil
	default:
		return "", fmt.Errorf("unsupported timing protocol %q", value)
	}
}

func timingPhasesForProtocol(protocol benchmark.TimingProtocol) []benchmark.TimingPhase {
	switch protocol {
	case benchmark.TimingProtocolColdOnly:
		return []benchmark.TimingPhase{benchmark.TimingPhaseCold}
	case benchmark.TimingProtocolHotOnly:
		return []benchmark.TimingPhase{benchmark.TimingPhaseHot}
	case benchmark.TimingProtocolFull:
		return []benchmark.TimingPhase{benchmark.TimingPhaseCold, benchmark.TimingPhaseHot}
	default:
		return []benchmark.TimingPhase{benchmark.TimingPhaseMixed}
	}
}

func defaultSuiteName(track benchmark.Track) string {
	if track == benchmark.TrackReplay {
		return "live-db"
	}
	return "core"
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			result = append(result, part)
		}
	}
	return result
}

func max(a, b int) int {
	if a >= b {
		return a
	}
	return b
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
