package engine

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/SuperCorks/llm-cli-suggestions/internal/api"
	"github.com/SuperCorks/llm-cli-suggestions/internal/config"
	"github.com/SuperCorks/llm-cli-suggestions/internal/db"
	"github.com/SuperCorks/llm-cli-suggestions/internal/model"
	_ "modernc.org/sqlite"
)

type stubModelClient struct {
	suggest func(ctx context.Context, prompt string) (model.SuggestResult, error)
}

func (s stubModelClient) Suggest(ctx context.Context, prompt string) (model.SuggestResult, error) {
	return s.suggest(ctx, prompt)
}

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

func TestSuggestAllowsEmptyBufferWithLastCommandContext(t *testing.T) {
	t.Parallel()

	store, err := db.NewStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	recordTestCommand(t, store, db.CommandRecord{
		SessionID:    "test-session",
		Command:      "git puhs",
		CWD:          "/tmp/project",
		RepoRoot:     "/tmp/project",
		Branch:       "main",
		ExitCode:     1,
		DurationMS:   80,
		StartedAtMS:  1000,
		FinishedAtMS: 1080,
	})

	var observedPrompt string
	engine := NewWithSystemPrompt(
		store,
		stubModelClient{suggest: func(ctx context.Context, prompt string) (model.SuggestResult, error) {
			observedPrompt = prompt
			return model.SuggestResult{Response: "git push"}, nil
		}},
		"qwen3-coder:latest",
		"http://127.0.0.1:11434",
		"5m",
		config.SuggestStrategyModelOnly,
		"",
		2*time.Second,
	)

	response, err := engine.Suggest(context.Background(), api.SuggestRequest{
		SessionID:    "test-session",
		Buffer:       "",
		CWD:          "/tmp/project",
		RepoRoot:     "/tmp/project",
		Branch:       "main",
		LastExitCode: 1,
		Strategy:     config.SuggestStrategyModelOnly,
	})
	if err != nil {
		t.Fatalf("suggest: %v", err)
	}

	if response.Suggestion != "git push" {
		t.Fatalf("expected git push, got %q", response.Suggestion)
	}
	if response.Source != "model" {
		t.Fatalf("expected model source, got %q", response.Source)
	}
	if !strings.Contains(observedPrompt, "buffer is empty right now. Use last_command and recent context") {
		t.Fatalf("expected empty-buffer prompt guidance, got %q", observedPrompt)
	}
	if !strings.Contains(observedPrompt, "last_command: git puhs") {
		t.Fatalf("expected last command in prompt, got %q", observedPrompt)
	}
	if !strings.Contains(observedPrompt, "current_buffer:\n\n") {
		t.Fatalf("expected empty current_buffer block, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "matching_history:") {
		t.Fatalf("did not expect history matches for empty buffer, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "path_matches:") {
		t.Fatalf("did not expect path matches for empty buffer, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "project_task_matches:") {
		t.Fatalf("did not expect project task matches for empty buffer, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "git_branch_matches:") {
		t.Fatalf("did not expect branch matches for empty buffer, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "project_tasks:") {
		t.Fatalf("did not expect project task list for empty buffer, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "current_token:") && !strings.Contains(observedPrompt, "current_token: \n") {
		t.Fatalf("expected empty current_token, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "matching_history:") {
		t.Fatalf("did not expect history candidates for empty buffer")
	}
	if strings.Contains(observedPrompt, "recent_commands:\n- git puhs") == false {
		t.Fatalf("expected recent commands in prompt, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "last_exit_code: 1") == false {
		t.Fatalf("expected last exit code in prompt, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "buffer is empty right now. Prefer the most likely correction of the last command or the most likely immediate follow-up command.") == false {
		t.Fatalf("expected empty-buffer correction guidance, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "buffer is empty right now. If there is no clear next step, return an empty response.") == false {
		t.Fatalf("expected empty-buffer empty-response guidance, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "The returned command must begin exactly with the current buffer.") == false {
		t.Fatalf("expected base system prompt in prompt, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "cwd: /tmp/project") == false {
		t.Fatalf("expected cwd in prompt, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "branch: main") == false {
		t.Fatalf("expected branch in prompt, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "repo_root: /tmp/project") == false {
		t.Fatalf("expected repo_root in prompt, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "recent_commands:") == false {
		t.Fatalf("expected recent commands section, got %q", observedPrompt)
	}
	if strings.Contains(observedPrompt, "last_command_context:") == false {
		t.Fatalf("expected last command context section, got %q", observedPrompt)
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

func TestLoadProjectTasksIncludesExpandedPackageScriptList(t *testing.T) {
	t.Parallel()

	cwd := t.TempDir()
	scripts := map[string]string{
		"build": "next build",
		"dev":   "next dev",
		"lint":  "eslint",
		"start": "next start",
		"test":  "vitest",
	}
	for index := 0; index < 40; index++ {
		scripts[fmt.Sprintf("task-%02d", index)] = "echo ok"
	}

	payload, err := json.Marshal(struct {
		Scripts map[string]string `json:"scripts"`
	}{Scripts: scripts})
	if err != nil {
		t.Fatalf("marshal package.json: %v", err)
	}
	writeFile(t, filepath.Join(cwd, "package.json"), string(payload))

	projectTasks := loadProjectTasks(cwd, cwd)
	if len(projectTasks) != len(scripts) {
		t.Fatalf("expected %d project tasks, got %d (%#v)", len(scripts), len(projectTasks), projectTasks)
	}
	for _, want := range []string{"build", "dev", "lint", "start", "test", "task-39"} {
		if !containsString(projectTasks, want) {
			t.Fatalf("expected project tasks to include %q, got %#v", want, projectTasks)
		}
	}
}

func TestInspectIncludesHistoryMatchesInRetrievedContext(t *testing.T) {
	t.Parallel()

	engine := newTestEngine(t)
	recordTestCommand(t, engine.store, db.CommandRecord{
		SessionID:    "test-session",
		Command:      "git checkout feature/demo",
		CWD:          "/tmp/project",
		RepoRoot:     "/tmp/project",
		Branch:       "main",
		ExitCode:     0,
		DurationMS:   50,
		StartedAtMS:  1000,
		FinishedAtMS: 1050,
	})
	recordTestCommand(t, engine.store, db.CommandRecord{
		SessionID:    "test-session",
		Command:      "git checkout feature/login",
		CWD:          "/tmp/project",
		RepoRoot:     "/tmp/project",
		Branch:       "main",
		ExitCode:     0,
		DurationMS:   50,
		StartedAtMS:  1100,
		FinishedAtMS: 1150,
	})

	response, err := engine.Inspect(context.Background(), api.InspectRequest{
		SessionID: "test-session",
		Buffer:    "git checkout fea",
		CWD:       "/tmp/project",
		RepoRoot:  "/tmp/project",
		Branch:    "main",
	})
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}

	if !containsString(response.RetrievedContext.HistoryMatches, "git checkout feature/demo") {
		t.Fatalf("expected history matches to include feature/demo, got %#v", response.RetrievedContext.HistoryMatches)
	}
	if !strings.Contains(response.Prompt, "matching_history:") {
		t.Fatalf("expected prompt to include matching history, got %q", response.Prompt)
	}
}

func TestInspectFallsBackToCWDContextWhenSessionIsEmpty(t *testing.T) {
	t.Parallel()

	engine := newTestEngine(t)
	recordTestCommand(t, engine.store, db.CommandRecord{
		SessionID:     "older-session",
		Command:       `copilot --prompt "hi"`,
		CWD:           "/tmp/hoptech",
		ExitCode:      0,
		DurationMS:    40,
		StartedAtMS:   1000,
		FinishedAtMS:  1040,
		StdoutExcerpt: "hello",
	})
	recordTestCommand(t, engine.store, db.CommandRecord{
		SessionID:    "older-session",
		Command:      "ls",
		CWD:          "/tmp/hoptech",
		ExitCode:     0,
		DurationMS:   20,
		StartedAtMS:  1100,
		FinishedAtMS: 1120,
	})

	response, err := engine.Inspect(context.Background(), api.InspectRequest{
		SessionID: "fresh-session",
		Buffer:    `copilot --prompt "what is the best`,
		CWD:       "/tmp/hoptech",
	})
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}

	if len(response.RecentCommands) == 0 {
		t.Fatalf("expected cwd fallback recent commands, got none")
	}
	if !containsString(response.RecentCommands, "ls") {
		t.Fatalf("expected ls in recent commands, got %#v", response.RecentCommands)
	}
	if response.LastCommand != "ls" {
		t.Fatalf("expected cwd fallback last command ls, got %q", response.LastCommand)
	}
	if len(response.RecentOutputContext) == 0 {
		t.Fatalf("expected cwd fallback recent output context")
	}
	if !containsRecentOutputCommand(response.RecentOutputContext, `copilot --prompt "hi"`) {
		t.Fatalf("expected cwd fallback output context for copilot prompt, got %#v", response.RecentOutputContext)
	}
	if !strings.Contains(response.Prompt, "recent_commands:") {
		t.Fatalf("expected prompt to include recent commands, got %q", response.Prompt)
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
		"",
		api.SuggestRequest{
			Buffer:       "git checkout fea",
			CWD:          "/tmp/project",
			RepoRoot:     "/tmp/project",
			Branch:       "main",
			LastExitCode: 0,
		},
		[]string{"git status", "git branch"},
		db.CommandContext{Command: "git branch"},
		[]api.InspectCommandContext{
			{
				Command:       "git branch",
				ExitCode:      0,
				StdoutExcerpt: "* main\n  feature/demo",
			},
		},
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
	if !strings.Contains(prompt, "last_command_context:") {
		t.Fatalf("expected prompt to include last_command_context block, got %q", prompt)
	}
}

func TestBuildPromptPrependsStaticSystemPrompt(t *testing.T) {
	t.Parallel()

	prompt := BuildPrompt(
		"Always prefer conservative completions.",
		api.SuggestRequest{Buffer: "git st"},
		nil,
		db.CommandContext{},
		nil,
		nil,
		api.InspectRetrievedContext{},
	)

	if !strings.HasPrefix(prompt, "Always prefer conservative completions.\n\ncwd: ") {
		t.Fatalf("expected custom system prompt prefix, got %q", prompt)
	}
}

func TestBuildPromptUsesDefaultSystemPromptWhenUnset(t *testing.T) {
	t.Parallel()

	prompt := BuildPrompt(
		"",
		api.SuggestRequest{Buffer: "git st"},
		nil,
		db.CommandContext{},
		nil,
		nil,
		api.InspectRetrievedContext{},
	)

	if !strings.HasPrefix(prompt, config.DefaultSystemPromptStatic+"\n\ncwd: ") {
		t.Fatalf("expected default system prompt prefix, got %q", prompt)
	}
}

func TestInspectReturnsLastThreeCommandContexts(t *testing.T) {
	t.Parallel()

	engine := newTestEngine(t)
	for index, command := range []string{"git status", "git branch", "git diff", "git log --oneline"} {
		recordTestCommand(t, engine.store, db.CommandRecord{
			SessionID:     "test-session",
			Command:       command,
			CWD:           "/tmp/project",
			RepoRoot:      "/tmp/project",
			Branch:        "main",
			ExitCode:      0,
			DurationMS:    40,
			StartedAtMS:   int64(1000 + index*100),
			FinishedAtMS:  int64(1040 + index*100),
			StdoutExcerpt: command + " output",
		})
	}

	response, err := engine.Inspect(context.Background(), api.InspectRequest{
		SessionID: "test-session",
		Buffer:    "git ch",
		CWD:       "/tmp/project",
		RepoRoot:  "/tmp/project",
		Branch:    "main",
	})
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}

	if len(response.LastCommandContext) != 3 {
		t.Fatalf("expected 3 last command contexts, got %#v", response.LastCommandContext)
	}
	if response.LastCommandContext[0].Command != "git log --oneline" {
		t.Fatalf("expected most recent command first, got %#v", response.LastCommandContext)
	}
	if !strings.Contains(response.Prompt, "git diff output") {
		t.Fatalf("expected prompt to include output from the last three commands, got %q", response.Prompt)
	}
}

func TestInspectUsesEngineDefaultStrategyWhenRequestStrategyEmpty(t *testing.T) {
	t.Parallel()

	cwd := t.TempDir()
	writeFile(t, filepath.Join(cwd, "package.json"), `{"scripts":{"dev":"next dev"}}`)

	store, err := db.NewStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	engine := NewWithSystemPrompt(
		store,
		nil,
		"qwen2.5-coder:7b",
		"http://127.0.0.1:11434",
		"5m",
		config.SuggestStrategyModelOnly,
		"",
		0,
	)

	result, err := engine.inspectDetailed(context.Background(), api.InspectRequest{
		SessionID: "test-session",
		Buffer:    "npm run d",
		CWD:       cwd,
		RepoRoot:  cwd,
	}, 0)
	if err != nil {
		t.Fatalf("inspectDetailed: %v", err)
	}

	if result.resolvedRequest.Strategy != config.SuggestStrategyModelOnly {
		t.Fatalf("expected default strategy %q, got %q", config.SuggestStrategyModelOnly, result.resolvedRequest.Strategy)
	}
	if result.response.HistoryTrusted {
		t.Fatalf("expected history not to be trusted in model-only mode")
	}
}

func TestInspectSurfacesModelTimeoutError(t *testing.T) {
	t.Parallel()

	store, err := db.NewStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	engine := NewWithSystemPrompt(
		store,
		stubModelClient{suggest: func(ctx context.Context, prompt string) (model.SuggestResult, error) {
			return model.SuggestResult{}, context.DeadlineExceeded
		}},
		"qwen3-coder:latest",
		"http://127.0.0.1:11434",
		"5m",
		config.SuggestStrategyModelOnly,
		"",
		2*time.Second,
	)

	response, err := engine.Inspect(context.Background(), api.InspectRequest{
		SessionID: "test-session",
		Buffer:    "git st",
		Strategy:  config.SuggestStrategyModelOnly,
	})
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}

	if response.Winner != nil {
		t.Fatalf("expected no winner, got %#v", response.Winner)
	}
	if len(response.Candidates) != 0 {
		t.Fatalf("expected no candidates, got %#v", response.Candidates)
	}
	if !strings.Contains(response.ModelError, "timed out after 10s") {
		t.Fatalf("expected timeout model error, got %q", response.ModelError)
	}
	if response.RawModelOutput != "" {
		t.Fatalf("expected empty raw model output, got %q", response.RawModelOutput)
	}
}

func TestInspectSurfacesRejectedModelOutput(t *testing.T) {
	t.Parallel()

	store, err := db.NewStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	engine := NewWithSystemPrompt(
		store,
		stubModelClient{suggest: func(ctx context.Context, prompt string) (model.SuggestResult, error) {
			return model.SuggestResult{Response: "status --short"}, nil
		}},
		"qwen3-coder:latest",
		"http://127.0.0.1:11434",
		"5m",
		config.SuggestStrategyModelOnly,
		"",
		2*time.Second,
	)

	response, err := engine.Inspect(context.Background(), api.InspectRequest{
		SessionID: "test-session",
		Buffer:    "git st",
		Strategy:  config.SuggestStrategyModelOnly,
	})
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}

	if response.Winner != nil {
		t.Fatalf("expected no winner, got %#v", response.Winner)
	}
	if response.RawModelOutput != "status --short" {
		t.Fatalf("expected raw model output to be preserved, got %q", response.RawModelOutput)
	}
	if response.CleanedModelOutput != "" {
		t.Fatalf("expected cleaned model output to be empty, got %q", response.CleanedModelOutput)
	}
	if !strings.Contains(response.ModelError, "did not start with the current buffer") {
		t.Fatalf("expected cleaned-output model error, got %q", response.ModelError)
	}
}

func TestInspectUsesLongerTimeoutThanLiveSuggestions(t *testing.T) {
	t.Parallel()

	store, err := db.NewStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	var observedDeadline time.Duration
	engine := NewWithSystemPrompt(
		store,
		stubModelClient{suggest: func(ctx context.Context, prompt string) (model.SuggestResult, error) {
			deadline, ok := ctx.Deadline()
			if !ok {
				t.Fatal("expected inspect context deadline")
			}
			observedDeadline = time.Until(deadline)
			return model.SuggestResult{Response: "git status"}, nil
		}},
		"qwen3-coder:latest",
		"http://127.0.0.1:11434",
		"5m",
		config.SuggestStrategyModelOnly,
		"",
		2*time.Second,
	)

	response, err := engine.Inspect(context.Background(), api.InspectRequest{
		SessionID: "test-session",
		Buffer:    "git st",
		Strategy:  config.SuggestStrategyModelOnly,
	})
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}

	if response.Winner == nil || response.Winner.Command != "git status" {
		t.Fatalf("expected git status winner, got %#v", response.Winner)
	}
	if observedDeadline < 9*time.Second {
		t.Fatalf("expected inspect timeout near 10s, got %s", observedDeadline)
	}
}

func TestInspectDoesNotCreateSession(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "test.db")
	store, err := db.NewStore(dbPath)
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	engine := NewWithSystemPrompt(
		store,
		nil,
		"qwen3-coder:latest",
		"http://127.0.0.1:11434",
		"5m",
		"history+model",
		"",
		5*time.Second,
	)

	if _, err := engine.Inspect(context.Background(), api.InspectRequest{
		SessionID: "inspect-session",
		Buffer:    "git st",
		CWD:       "/tmp/project",
		RepoRoot:  "/tmp/project",
	}); err != nil {
		t.Fatalf("inspect: %v", err)
	}

	rawDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open raw sqlite: %v", err)
	}
	t.Cleanup(func() {
		_ = rawDB.Close()
	})

	var sessionCount int
	if err := rawDB.QueryRowContext(
		context.Background(),
		"SELECT COUNT(*) FROM sessions WHERE id = ?",
		"inspect-session",
	).Scan(&sessionCount); err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	if sessionCount != 0 {
		t.Fatalf("expected inspect to avoid session writes, found %d session rows", sessionCount)
	}
}

func newTestEngine(t testing.TB) *Engine {
	t.Helper()

	store, err := db.NewStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	return NewWithSystemPrompt(store, nil, "qwen2.5-coder:7b", "http://127.0.0.1:11434", "5m", "history+model", "", 0)
}

func initGitRepo(t testing.TB, root string) {
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

func runGit(t testing.TB, root string, args ...string) {
	t.Helper()

	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, string(output))
	}
}

func writeFile(t testing.TB, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func mustMkdir(t testing.TB, path string) {
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

func recordTestCommand(t testing.TB, store *db.Store, record db.CommandRecord) {
	t.Helper()
	if err := store.RecordCommand(context.Background(), record); err != nil {
		t.Fatalf("record command: %v", err)
	}
}
