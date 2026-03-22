package engine

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/SuperCorks/cli-auto-complete/internal/api"
	"github.com/SuperCorks/cli-auto-complete/internal/db"
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
