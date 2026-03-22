package engine

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/SuperCorks/llm-cli-suggestions/internal/api"
	"github.com/SuperCorks/llm-cli-suggestions/internal/db"
)

func TestSuggestUsesProjectTaskRetrieval(t *testing.T) {
	t.Parallel()

	cwd := t.TempDir()
	writeFile(t, filepath.Join(cwd, "package.json"), `{"scripts":{"dev":"next dev","build":"next build"}}`)

	engine := newTestEngine(t)
	response, err := engine.Suggest(context.Background(), api.SuggestRequest{
		SessionID: "test-session",
		Buffer:    "npm run d",
		CWD:       cwd,
		RepoRoot:  cwd,
	})
	if err != nil {
		t.Fatalf("suggest: %v", err)
	}

	if response.Suggestion != "npm run dev" {
		t.Fatalf("expected npm run dev, got %q", response.Suggestion)
	}
	if response.Source != "project-task" {
		t.Fatalf("expected project-task source, got %q", response.Source)
	}
}

func TestInspectIncludesPathRetrievedContext(t *testing.T) {
	t.Parallel()

	cwd := t.TempDir()
	mustMkdir(t, filepath.Join(cwd, "src"))
	mustMkdir(t, filepath.Join(cwd, "scripts"))
	writeFile(t, filepath.Join(cwd, "schema.sql"), "select 1;")

	engine := newTestEngine(t)
	response, err := engine.Inspect(context.Background(), api.InspectRequest{
		SessionID: "test-session",
		Buffer:    "git add s",
		CWD:       cwd,
		RepoRoot:  cwd,
	})
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}

	if response.Winner == nil {
		t.Fatalf("expected winner")
	}
	if !strings.Contains(response.Winner.Source, "path") {
		t.Fatalf("expected path source, got %q", response.Winner.Source)
	}
	if len(response.RetrievedContext.PathMatches) == 0 {
		t.Fatalf("expected path matches")
	}
	if !containsString(response.RetrievedContext.PathMatches, "src/") {
		t.Fatalf("expected src/ in path matches, got %#v", response.RetrievedContext.PathMatches)
	}
	if !strings.Contains(response.Prompt, "path_matches:") {
		t.Fatalf("expected prompt to include path matches, got %q", response.Prompt)
	}
}

func TestInspectIncludesProjectTasksInPromptWithoutTaskSpecificBuffer(t *testing.T) {
	t.Parallel()

	cwd := t.TempDir()
	writeFile(t, filepath.Join(cwd, "package.json"), `{"scripts":{"dev":"next dev","build":"next build"}}`)

	engine := newTestEngine(t)
	response, err := engine.Inspect(context.Background(), api.InspectRequest{
		SessionID: "test-session",
		Buffer:    "npm",
		CWD:       cwd,
		RepoRoot:  cwd,
	})
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}

	if !containsString(response.RetrievedContext.ProjectTasks, "dev") {
		t.Fatalf("expected dev in project tasks, got %#v", response.RetrievedContext.ProjectTasks)
	}
	if !strings.Contains(response.Prompt, "project_tasks:") {
		t.Fatalf("expected prompt to include project tasks, got %q", response.Prompt)
	}
}

func TestSuggestUsesGitBranchRetrieval(t *testing.T) {
	t.Parallel()

	repoRoot := t.TempDir()
	initGitRepo(t, repoRoot)

	engine := newTestEngine(t)
	response, err := engine.Suggest(context.Background(), api.SuggestRequest{
		SessionID: "test-session",
		Buffer:    "git switch fea",
		CWD:       repoRoot,
		RepoRoot:  repoRoot,
		Branch:    "main",
	})
	if err != nil {
		t.Fatalf("suggest: %v", err)
	}

	if response.Suggestion != "git switch feature/demo" {
		t.Fatalf("expected git switch feature/demo, got %q", response.Suggestion)
	}
	if response.Source != "git-branch" {
		t.Fatalf("expected git-branch source, got %q", response.Source)
	}
}

func TestSelectRecentOutputContextPrefersRelevantEntries(t *testing.T) {
	t.Parallel()

	request := api.SuggestRequest{
		SessionID: "test-session",
		Buffer:    "git checkout fea",
		CWD:       "/tmp/project",
		RepoRoot:  "/tmp/project",
		Branch:    "main",
	}
	selected := selectRecentOutputContext(request, []db.RecentOutputContext{
		{
			Command:       "npm test",
			ExitCode:      0,
			StdoutExcerpt: "all tests passed",
			FinishedAtMS:  3000,
		},
		{
			Command:       "git branch",
			ExitCode:      0,
			StdoutExcerpt: "* main\n  feature/demo\n  fix/login",
			FinishedAtMS:  2000,
		},
		{
			Command:       "git checkout nope",
			ExitCode:      1,
			StderrExcerpt: "error: pathspec 'nope' did not match any file(s) known to git",
			FinishedAtMS:  1000,
		},
	})

	if len(selected) == 0 {
		t.Fatalf("expected selected recent output context")
	}
	if containsRecentOutputCommand(selected, "npm test") {
		t.Fatalf("did not expect unrelated npm test output to be selected: %#v", selected)
	}
	if !containsRecentOutputCommand(selected, "git branch") {
		t.Fatalf("expected git branch output to be selected: %#v", selected)
	}
	if !containsRecentOutputCommand(selected, "git checkout nope") {
		t.Fatalf("expected failing git checkout output to be selected: %#v", selected)
	}
}

func TestInspectIncludesRecentOutputContextAndOutputBonus(t *testing.T) {
	t.Parallel()

	repoRoot := t.TempDir()
	initGitRepo(t, repoRoot)

	engine := newTestEngine(t)
	recordTestCommand(t, engine.store, db.CommandRecord{
		SessionID:     "test-session",
		Command:       "git branch",
		CWD:           repoRoot,
		RepoRoot:      repoRoot,
		Branch:        "main",
		ExitCode:      0,
		DurationMS:    80,
		StartedAtMS:   1000,
		FinishedAtMS:  1080,
		StdoutExcerpt: "* main\n  feature/demo\n  fix/login",
	})

	response, err := engine.Inspect(context.Background(), api.InspectRequest{
		SessionID: "test-session",
		Buffer:    "git checkout fea",
		CWD:       repoRoot,
		RepoRoot:  repoRoot,
		Branch:    "main",
	})
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}

	if len(response.RecentOutputContext) == 0 {
		t.Fatalf("expected recent output context in inspect response")
	}
	if !strings.Contains(response.Prompt, "recent_output_context:") {
		t.Fatalf("expected prompt to include recent output context, got %q", response.Prompt)
	}
	if !containsRecentOutputCommand(response.RecentOutputContext, "git branch") {
		t.Fatalf("expected git branch output in inspect response: %#v", response.RecentOutputContext)
	}

	candidate := findCandidate(response.Candidates, "git checkout feature/demo")
	if candidate == nil {
		t.Fatalf("expected git checkout feature/demo candidate, got %#v", response.Candidates)
	}
	if candidate.Breakdown.OutputContext <= 0 {
		t.Fatalf("expected output-context bonus, got %+v", candidate.Breakdown)
	}
}

func TestBuildPromptIncludesRecentOutputContext(t *testing.T) {
	t.Parallel()

	prompt := BuildPrompt(
		api.SuggestRequest{
			Buffer:       "git checkout fea",
			CWD:          "/tmp/project",
			RepoRoot:     "/tmp/project",
			Branch:       "main",
			LastExitCode: 0,
		},
		[]string{"git status", "git branch"},
		db.CommandContext{Command: "git branch"},
		[]api.InspectRecentOutputContext{
			{
				Command:       "git branch",
				ExitCode:      0,
				StdoutExcerpt: "* main\n  feature/demo",
				Score:         20,
			},
		},
		api.InspectRetrievedContext{CurrentToken: "fea"},
	)

	if !strings.Contains(prompt, "recent_output_context:") {
		t.Fatalf("expected recent_output_context block, got %q", prompt)
	}
	if !strings.Contains(prompt, "feature/demo") {
		t.Fatalf("expected prompt to include selected output text, got %q", prompt)
	}
}

func newTestEngine(t *testing.T) *Engine {
	t.Helper()

	store, err := db.NewStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	return New(store, nil, "qwen2.5-coder:7b", "http://127.0.0.1:11434", "history+model", 0)
}

func initGitRepo(t *testing.T, root string) {
	t.Helper()

	runGit(t, root, "init", "-b", "main")
	runGit(t, root, "config", "user.email", "test@example.com")
	runGit(t, root, "config", "user.name", "Test User")
	writeFile(t, filepath.Join(root, "README.md"), "hello")
	runGit(t, root, "add", "README.md")
	runGit(t, root, "commit", "-m", "init")
	runGit(t, root, "branch", "feature/demo")
	runGit(t, root, "branch", "fix/login")
}

func runGit(t *testing.T, root string, args ...string) {
	t.Helper()

	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, string(output))
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func mustMkdir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func containsRecentOutputCommand(values []api.InspectRecentOutputContext, want string) bool {
	for _, value := range values {
		if value.Command == want {
			return true
		}
	}
	return false
}

func findCandidate(values []api.InspectCandidate, want string) *api.InspectCandidate {
	for index := range values {
		if values[index].Command == want {
			return &values[index]
		}
	}
	return nil
}

func recordTestCommand(t *testing.T, store *db.Store, record db.CommandRecord) {
	t.Helper()
	if err := store.RecordCommand(context.Background(), record); err != nil {
		t.Fatalf("record command: %v", err)
	}
}
