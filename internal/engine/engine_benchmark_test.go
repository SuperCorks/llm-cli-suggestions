package engine

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/SuperCorks/llm-cli-suggestions/internal/api"
	"github.com/SuperCorks/llm-cli-suggestions/internal/db"
)

func BenchmarkInspectGitCheckoutMixedRetrieval(b *testing.B) {
	repoRoot := b.TempDir()
	initGitRepo(b, repoRoot)

	for index := 0; index < 400; index++ {
		runGit(b, repoRoot, "branch", fmt.Sprintf("feature/bench-%03d", index))
	}

	for index := 0; index < 2500; index++ {
		name := fmt.Sprintf("feature-file-%04d.txt", index)
		writeFile(b, filepath.Join(repoRoot, name), "bench")
	}
	mustMkdir(b, filepath.Join(repoRoot, "feature-assets"))

	engine := newTestEngine(b)
	for index := 0; index < 1200; index++ {
		branchName := fmt.Sprintf("feature/bench-%03d", index%400)
		recordTestCommand(b, engine.store, db.CommandRecord{
			SessionID:     "bench-session",
			Command:       "git checkout " + branchName,
			CWD:           repoRoot,
			RepoRoot:      repoRoot,
			Branch:        "main",
			ExitCode:      0,
			DurationMS:    80,
			StartedAtMS:   int64(index * 100),
			FinishedAtMS:  int64(index*100 + 80),
			StdoutExcerpt: branchName,
		})
	}
	recordTestCommand(b, engine.store, db.CommandRecord{
		SessionID:     "bench-session",
		Command:       "git branch",
		CWD:           repoRoot,
		RepoRoot:      repoRoot,
		Branch:        "main",
		ExitCode:      0,
		DurationMS:    90,
		StartedAtMS:   500000,
		FinishedAtMS:  500090,
		StdoutExcerpt: "* main\n  feature/demo\n  feature/bench-001\n  feature/bench-200",
	})

	request := api.InspectRequest{
		SessionID: "bench-session",
		Buffer:    "git checkout fea",
		CWD:       repoRoot,
		RepoRoot:  repoRoot,
		Branch:    "main",
		Limit:     8,
	}

	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		response, err := engine.Inspect(context.Background(), request)
		if err != nil {
			b.Fatalf("inspect: %v", err)
		}
		if response.Winner == nil {
			b.Fatal("expected winner")
		}
	}
}
