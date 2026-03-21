import { expect, test, type Page } from "@playwright/test";

function getDetailBlock(page: Page, heading: string) {
  return page.locator(".detail-block").filter({
    has: page.getByRole("heading", { name: heading }),
  });
}

test("dashboard renders seeded overview data", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("cli-auto-complete Console").first()).toBeVisible();
  await expect(page.getByText("Avg. latency")).toBeVisible();
  await expect(page.getByText("git status").first()).toBeVisible();
  await expect(page.getByText("history+model suggestion for git st")).toBeVisible();
  await expect(page.getByText("qwen2.5-coder:7b").first()).toBeVisible();
});

test("suggestions and commands pages render seeded history", async ({ page }) => {
  await page.goto("/suggestions");

  await expect(page.getByRole("heading", { name: "Suggestions" })).toBeVisible();
  await page.getByLabel("Query").fill("git st");
  await page.getByLabel("Outcome").selectOption("accepted");
  await page.getByRole("button", { name: "Apply Filters" }).click();

  await expect(page.getByText("git status").first()).toBeVisible();
  await expect(page.getByText("No suggestions matched the selected filters.")).toHaveCount(0);

  await page.goto("/commands");
  await expect(page.getByRole("heading", { name: "Commands & Feedback" })).toBeVisible();
  await expect(page.getByText("session-alpha").first()).toBeVisible();
  await expect(page.getByText("npm run build").first()).toBeVisible();
  await expect(page.getByText("git status").nth(0)).toBeVisible();
  await page.getByLabel("Query").fill("git");
  await page.getByRole("button", { name: "Apply Filters" }).click();
  await expect(page.getByText("No rejected suggestions yet.")).toBeVisible();
  await expect(page.getByText("session-alpha").first()).toBeVisible();
  await expect(page.getByText("git status").nth(0)).toBeVisible();
  await expect(page.getByText("npm run build").first()).toHaveCount(0);
});

test("ranking inspector shows a mocked winner", async ({ page }) => {
  await page.route("**/api/ranking", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        model_name: "qwen2.5-coder:7b",
        history_trusted: false,
        prompt: "mock prompt",
        raw_model_output: "git status --short",
        cleaned_model_output: "git status --short",
        recent_commands: ["git fetch", "git checkout main"],
        last_command: "git fetch",
        last_stdout_excerpt: "Already up to date.",
        last_stderr_excerpt: "",
        winner: {
          command: "git status --short",
          source: "model",
          score: 92,
          latency_ms: 143,
          history_score: 24,
          accepted_count: 3,
          rejected_count: 0,
          breakdown: {
            history: 24,
            model: 50,
            feedback: 8,
            recent_usage: 5,
            last_context: 5,
            total: 92,
          },
        },
        candidates: [
          {
            command: "git status --short",
            source: "model",
            score: 92,
            latency_ms: 143,
            history_score: 24,
            accepted_count: 3,
            rejected_count: 0,
            breakdown: {
              history: 24,
              model: 50,
              feedback: 8,
              recent_usage: 5,
              last_context: 5,
              total: 92,
            },
          },
          {
            command: "git status",
            source: "history",
            score: 80,
            latency_ms: 0,
            history_score: 40,
            accepted_count: 5,
            rejected_count: 1,
            breakdown: {
              history: 40,
              model: 0,
              feedback: 18,
              recent_usage: 12,
              last_context: 10,
              total: 80,
            },
          },
        ],
      }),
    });
  });

  await page.goto("/ranking");

  await expect(page.getByRole("heading", { name: "Ranking Inspector" })).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/ranking") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Inspect Ranking" }).click(),
  ]);

  await expect(page.getByText("Winning candidate")).toBeVisible();
  await expect(page.getByText("git status --short").first()).toBeVisible();
  await expect(page.getByText("mock prompt")).toBeVisible();
});

test("ranking inspector tolerates null prompt context fields", async ({ page }) => {
  await page.route("**/api/ranking", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        model_name: "qwen2.5-coder:7b",
        history_trusted: false,
        prompt: "",
        raw_model_output: "",
        cleaned_model_output: "",
        recent_commands: null,
        last_command: null,
        last_stdout_excerpt: null,
        last_stderr_excerpt: null,
        winner: null,
        candidates: [],
      }),
    });
  });

  await page.goto("/ranking");
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/ranking") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Inspect Ranking" }).click(),
  ]);

  await expect(page.getByText("No suggestion")).toBeVisible();
  await expect(page.getByText("No raw model output.")).toBeVisible();
  await expect(page.getByText("No prompt generated.")).toBeVisible();
  await expect(page.getByText("Recent commands").first()).toBeVisible();
  await expect(page.getByText("0").first()).toBeVisible();
});

test("ranking inspector validates form state and forwards edited context", async ({ page }) => {
  let capturedPayload: Record<string, unknown> | null = null;

  await page.route("**/api/ranking", async (route) => {
    capturedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        model_name: "mistral-small",
        history_trusted: true,
        prompt: "ranking payload prompt",
        raw_model_output: "pnpm test --filter web",
        cleaned_model_output: "pnpm test --filter web",
        recent_commands: ["pnpm install", "pnpm lint"],
        last_command: "pnpm lint",
        last_stdout_excerpt: "lint ok",
        last_stderr_excerpt: "",
        winner: {
          command: "pnpm test --filter web",
          source: "model",
          score: 88,
          latency_ms: 211,
          history_score: 28,
          accepted_count: 4,
          rejected_count: 1,
          breakdown: {
            history: 28,
            model: 40,
            feedback: 7,
            recent_usage: 8,
            last_context: 5,
            total: 88,
          },
        },
        candidates: [
          {
            command: "pnpm test --filter web",
            source: "model",
            score: 88,
            latency_ms: 211,
            history_score: 28,
            accepted_count: 4,
            rejected_count: 1,
            breakdown: {
              history: 28,
              model: 40,
              feedback: 7,
              recent_usage: 8,
              last_context: 5,
              total: 88,
            },
          },
        ],
      }),
    });
  });

  await page.goto("/ranking");

  const submit = page.getByRole("button", { name: "Inspect Ranking" });
  await page.getByLabel("Buffer").fill("");
  await expect(submit).toBeDisabled();
  await expect(page.getByText("Buffer is required.")).toBeVisible();

  await page.getByLabel("Buffer").fill("pnpm te");
  await page.getByLabel("Session ID").fill("ranking-session");
  await page.getByLabel("CWD").fill("/Users/simon/projects/web");
  await page.getByLabel("Repo Root").fill("/Users/simon/projects/web");
  await page.getByLabel("Branch").fill("feature/ranking");
  await page.getByLabel("Last Exit Code").fill("17");
  await page.getByRole("textbox", { name: "Model", exact: true }).fill("mistral-small");
  await page.getByLabel("Suggestion Strategy").selectOption("model-only");
  await expect(
    page.getByText("Ignores history candidates and relies entirely on the model for suggestions.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Model Base URL", exact: true }).fill(
    "http://127.0.0.1:22444",
  );
  await page.getByLabel("Recent Commands").fill("pnpm install\npnpm lint");

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/ranking") && response.request().method() === "POST",
    ),
    submit.click(),
  ]);

  expect(capturedPayload).not.toBeNull();
  expect(capturedPayload).toMatchObject({
    session_id: "ranking-session",
    buffer: "pnpm te",
    cwd: "/Users/simon/projects/web",
    repo_root: "/Users/simon/projects/web",
    branch: "feature/ranking",
    last_exit_code: 17,
    model_name: "mistral-small",
    model_base_url: "http://127.0.0.1:22444",
    strategy: "model-only",
    recent_commands: ["pnpm install", "pnpm lint"],
    limit: 8,
  });

  await expect(page.getByText("Winning candidate")).toBeVisible();
  await expect(page.getByText("pnpm test --filter web").first()).toBeVisible();
  await expect(page.getByText("ranking payload prompt")).toBeVisible();
  await expect(page.getByText("History trusted:")).toBeVisible();
});

test("ranking inspector renders model-only results with raw model output", async ({ page }) => {
  await page.route("**/api/ranking", async (route) => {
    const payload = route.request().postDataJSON() as { strategy?: string };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        model_name: "qwen2.5-coder:7b",
        history_trusted: false,
        prompt: "model-only prompt",
        raw_model_output: "git status --short",
        cleaned_model_output: "git status --short",
        recent_commands: ["git status", "pnpm test", "npm run dev"],
        last_command: "",
        last_stdout_excerpt: "",
        last_stderr_excerpt: "",
        winner: {
          command: "git status --short",
          source: "model",
          score: 26,
          latency_ms: 187,
          history_score: 0,
          accepted_count: 0,
          rejected_count: 0,
          breakdown: {
            history: 0,
            model: 26,
            feedback: 0,
            recent_usage: 0,
            last_context: 0,
            total: 26,
          },
        },
        candidates: [
          {
            command: "git status --short",
            source: "model",
            score: 26,
            latency_ms: 187,
            history_score: 0,
            accepted_count: 0,
            rejected_count: 0,
            breakdown: {
              history: 0,
              model: 26,
              feedback: 0,
              recent_usage: 0,
              last_context: 0,
              total: 26,
            },
          },
        ],
        echoed_strategy: payload.strategy,
      }),
    });
  });

  await page.goto("/ranking");
  await page.getByLabel("Suggestion Strategy").selectOption("model-only");
  await page.getByLabel("Recent Commands").fill("git status\npnpm test\nnpm run dev");

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/ranking") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Inspect Ranking" }).click(),
  ]);

  await expect(page.getByText("git status --short").first()).toBeVisible();
  await expect(page.getByText("No raw model output.")).toHaveCount(0);
  await expect(page.getByText("model-only prompt")).toBeVisible();
  await expect(page.getByText("source").first()).toBeVisible();
  await expect(page.getByText("model").nth(0)).toBeVisible();
  await expect(page.getByText("187 ms")).toBeVisible();
});

test("ranking inspector surfaces empty model-only output state", async ({ page }) => {
  await page.route("**/api/ranking", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        model_name: "qwen2.5-coder:7b",
        history_trusted: false,
        prompt: "model-only empty-output prompt",
        raw_model_output: "",
        cleaned_model_output: "",
        recent_commands: ["git status", "pnpm test", "npm run dev"],
        last_command: "",
        last_stdout_excerpt: "",
        last_stderr_excerpt: "",
        winner: null,
        candidates: [],
      }),
    });
  });

  await page.goto("/ranking");
  await page.getByLabel("Suggestion Strategy").selectOption("model-only");
  await page.getByLabel("Recent Commands").fill("git status\npnpm test\nnpm run dev");

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/ranking") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Inspect Ranking" }).click(),
  ]);

  await expect(page.getByText("No suggestion")).toBeVisible();
  await expect(page.getByText("No raw model output.")).toBeVisible();
  await expect(page.getByText("model-only empty-output prompt")).toBeVisible();
  await expect(
    page.locator(".detail-block").filter({ has: page.getByRole("heading", { name: "Candidate Scores" }) }),
  ).toBeVisible();
});

test("ranking inspector clears stale results and shows api errors", async ({ page }) => {
  let requestCount = 0;

  await page.route("**/api/ranking", async (route) => {
    requestCount += 1;

    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          model_name: "qwen2.5-coder:7b",
          history_trusted: false,
          prompt: "first pass prompt",
          raw_model_output: "git status",
          cleaned_model_output: "git status",
          recent_commands: [],
          last_command: "",
          last_stdout_excerpt: "",
          last_stderr_excerpt: "",
          winner: {
            command: "git status",
            source: "history",
            score: 81,
            latency_ms: 0,
            history_score: 44,
            accepted_count: 5,
            rejected_count: 0,
            breakdown: {
              history: 44,
              model: 0,
              feedback: 15,
              recent_usage: 12,
              last_context: 10,
              total: 81,
            },
          },
          candidates: [
            {
              command: "git status",
              source: "history",
              score: 81,
              latency_ms: 0,
              history_score: 44,
              accepted_count: 5,
              rejected_count: 0,
              breakdown: {
                history: 44,
                model: 0,
                feedback: 15,
                recent_usage: 12,
                last_context: 10,
                total: 81,
              },
            },
          ],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: "daemon inspect failed",
      }),
    });
  });

  await page.goto("/ranking");

  await page.getByRole("button", { name: "Inspect Ranking" }).click();
  await expect(page.getByText("Winning candidate")).toBeVisible();
  await expect(page.getByText("git status").first()).toBeVisible();

  await page.getByLabel("Buffer").fill("broken");
  await page.getByRole("button", { name: "Inspect Ranking" }).click();

  await expect(page.getByText("daemon inspect failed")).toBeVisible();
  await expect(page.getByText("Winning candidate")).toHaveCount(0);
  await expect(page.getByText("first pass prompt")).toHaveCount(0);
});

test("model lab guardrails and defaults work with local fixtures", async ({ page }) => {
  await page.goto("/lab");

  const benchmarkPanel = getDetailBlock(page, "Run Saved Benchmarks");
  const adHocPanel = getDetailBlock(page, "Ad-Hoc Model Test");

  await expect(
    page.locator(".compact-metrics").getByText("Current runtime model", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("qwen2.5-coder:7b").first()).toBeVisible();
  await expect(
    benchmarkPanel.getByRole("button", { name: "Queue Benchmark" }),
  ).toBeEnabled();

  await benchmarkPanel.getByRole("button", { name: "Clear" }).click();
  await expect(
    benchmarkPanel.getByRole("button", { name: "Queue Benchmark" }),
  ).toBeDisabled();

  await benchmarkPanel.getByRole("button", { name: "Reset Form" }).click();
  await expect(
    benchmarkPanel.getByRole("button", { name: "Queue Benchmark" }),
  ).toBeEnabled();

  await adHocPanel.getByLabel("Buffer").fill("");
  await expect(adHocPanel.getByRole("button", { name: "Run Ad-Hoc Test" })).toBeDisabled();
  await adHocPanel.getByRole("button", { name: "Reset Context" }).click();
  await expect(adHocPanel.getByLabel("Buffer")).toHaveValue("git st");
  await expect(adHocPanel.getByRole("button", { name: "Run Ad-Hoc Test" })).toBeEnabled();
});

test("model lab benchmark flow works with local fixtures", async ({ page }) => {
  await page.route("**/api/benchmarks/run", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        runId: 77,
      }),
    });
  });

  await page.route("**/api/benchmarks", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            id: 77,
            status: "queued",
            models: ["qwen2.5-coder:7b", "mistral-small"],
            repeatCount: 2,
            timeoutMs: 5000,
            outputJsonPath: "/tmp/run-77.json",
            summary: null,
            errorText: "",
            createdAtMs: Date.now(),
            startedAtMs: 0,
            finishedAtMs: 0,
          },
          {
            id: 1,
            status: "completed",
            models: ["qwen2.5-coder:7b"],
            repeatCount: 2,
            timeoutMs: 5000,
            outputJsonPath: "/tmp/run-1.json",
            summary: null,
            errorText: "",
            createdAtMs: Date.now() - 1000,
            startedAtMs: Date.now() - 1000,
            finishedAtMs: Date.now(),
          },
        ],
      }),
    });
  });

  await page.route("**/api/benchmarks/77", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run: {
          id: 77,
          status: "completed",
          models: ["qwen2.5-coder:7b", "mistral-small"],
          repeatCount: 2,
          timeoutMs: 5000,
          outputJsonPath: "/tmp/run-77.json",
          summary: null,
          errorText: "",
          createdAtMs: Date.now(),
          startedAtMs: Date.now(),
          finishedAtMs: Date.now(),
        },
        results: [
          {
            id: 701,
            runId: 77,
            modelName: "mistral-small",
            caseName: "git status prompt",
            runNumber: 1,
            latencyMs: 192,
            suggestionText: "git status --short",
            validPrefix: true,
            accepted: true,
            errorText: "",
            createdAtMs: Date.now(),
          },
        ],
      }),
    });
  });

  await page.goto("/lab");

  const benchmarkPanel = getDetailBlock(page, "Run Saved Benchmarks");
  await benchmarkPanel.getByLabel("Models").click();
  await benchmarkPanel.getByRole("option", { name: /mistral-small/i }).click();
  await expect(benchmarkPanel.getByLabel("Models")).toHaveValue(/qwen2\.5-coder:7b \+1 more/);
  await expect(benchmarkPanel.getByText("mistral-small")).toBeVisible();
  await benchmarkPanel.getByLabel("Models").fill("llama3.2:latest");
  await benchmarkPanel.getByRole("button", { name: "Add" }).click();
  await expect(benchmarkPanel.getByText("llama3.2:latest")).toBeVisible();

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/benchmarks/run") && response.request().method() === "POST",
    ),
    benchmarkPanel.getByRole("button", { name: "Queue Benchmark" }).click(),
  ]);

  await expect(page.getByText("Benchmark queued as run #77.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "#77" })).toBeVisible();

  const queuedRunRow = page.locator("tr").filter({ has: page.getByRole("cell", { name: "#77" }) });
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/benchmarks/77") && response.request().method() === "GET",
    ),
    queuedRunRow.getByRole("button", { name: "View" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Benchmark Run #77" })).toBeVisible();
  await expect(page.getByText("git status --short")).toBeVisible();
  await page.getByRole("button", { name: "Close Run" }).click();
  await expect(page.getByRole("heading", { name: "Benchmark Run #77" })).toHaveCount(0);
});

test("model lab ad-hoc flow works with local fixtures", async ({ page }) => {
  let rankingRequestCount = 0;

  await page.route("**/api/ranking", async (route) => {
    rankingRequestCount += 1;
    const payload = route.request().postDataJSON() as {
      model_name?: string;
      recent_commands?: string[];
    };
    const modelName = payload.model_name || "unknown";

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        model_name: modelName,
        winner: {
          command:
            modelName === "phi4"
              ? "git status --short"
              : 'git commit -m "ship console"',
          source: "model",
        },
        cleaned_model_output:
          modelName === "phi4"
            ? "git status --short"
            : 'git commit -m "ship console"',
        raw_model_output:
          payload.recent_commands && payload.recent_commands.length > 0
            ? `${modelName} used recent commands`
            : `${modelName} no history`,
        candidates: [
          {
            command:
              modelName === "phi4"
                ? "git status --short"
                : 'git commit -m "ship console"',
            source: "model",
            score: modelName === "phi4" ? 84 : 88,
          },
        ],
      }),
    });
  });

  await page.goto("/lab");

  const adHocPanel = getDetailBlock(page, "Ad-Hoc Model Test");
  await adHocPanel.getByLabel("Models").click();
  await adHocPanel.getByRole("option", { name: /phi4/i }).click();
  await expect(adHocPanel.getByLabel("Models")).toHaveValue(/qwen2\.5-coder:7b \+1 more/);
  await expect(adHocPanel.getByText("phi4")).toBeVisible();
  await adHocPanel.getByLabel("Models").fill("mistral-small");
  await adHocPanel.getByRole("button", { name: "Add" }).click();
  await expect(adHocPanel.getByText("mistral-small")).toBeVisible();
  await adHocPanel.getByLabel("Recent Commands").fill("git fetch\npnpm test");

  await adHocPanel.getByRole("button", { name: "Run Ad-Hoc Test" }).click();
  await expect.poll(() => rankingRequestCount).toBe(3);

  await expect(page.getByRole("heading", { name: "Ad-Hoc Results" })).toBeVisible();
  await expect(page.getByText("Compared 3 models")).toBeVisible();
  await expect(page.getByText("phi4 used recent commands")).toBeVisible();
  await expect(page.getByText('git commit -m "ship console"').first()).toBeVisible();

  await adHocPanel.getByRole("button", { name: "Clear Results" }).click();
  await expect(page.getByRole("heading", { name: "Ad-Hoc Results" })).toHaveCount(0);
});

test("daemon runtime settings and downloads work with local fixtures", async ({ page }) => {
  let installPollCount = 0;
  let openPathCalls = 0;

  await page.route("**/api/ollama/install", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        job: {
          id: "install-alfred",
          model: "alfred",
          status: "running",
          message: "pulling manifest",
          progressPercent: 12,
          completed: 12,
          total: 100,
          error: "",
          startedAtMs: Date.now(),
          updatedAtMs: Date.now(),
          finishedAtMs: 0,
        },
      }),
    });
  });

  await page.route("**/api/ollama/install/install-alfred", async (route) => {
    installPollCount += 1;
    const isComplete = installPollCount > 1;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        job: {
          id: "install-alfred",
          model: "alfred",
          status: isComplete ? "completed" : "running",
          message: isComplete ? "Download complete" : "pulling layers",
          progressPercent: isComplete ? 100 : 68,
          completed: isComplete ? 100 : 68,
          total: 100,
          error: "",
          startedAtMs: Date.now(),
          updatedAtMs: Date.now(),
          finishedAtMs: isComplete ? Date.now() : 0,
        },
      }),
    });
  });

  await page.route("**/api/ollama/models?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          { name: "qwen2.5-coder:7b", installed: true, source: "installed" },
          { name: "llama3.2:latest", installed: true, source: "installed" },
          { name: "alfred", installed: true, source: "installed" },
          { name: "phi4", installed: false, source: "library" },
        ],
        installedCount: 3,
        libraryCount: 1,
      }),
    });
  });

  await page.route("**/api/system/open-path", async (route) => {
    openPathCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/daemon");
  await expect(page.getByRole("heading", { name: "Daemon & Data Ops" })).toBeVisible();
  await expect(page.getByText("Model warmed up in 146ms")).toBeVisible();
  const runtimeSettingsPanel = getDetailBlock(page, "Runtime Settings");
  await expect(runtimeSettingsPanel.getByLabel("Model Name")).toHaveValue("qwen2.5-coder:7b");
  await expect(runtimeSettingsPanel.locator(".chip-list")).toHaveCount(0);
  await expect(runtimeSettingsPanel.getByLabel("Suggestion Strategy")).toHaveValue("history+model");
  await runtimeSettingsPanel.getByLabel("Suggestion Strategy").selectOption("history-only");
  await expect(
    runtimeSettingsPanel.getByText(
      "Uses past command history only. Fastest and closest to classic terminal autosuggestions.",
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByLabel("Model Name").fill("alf");
  await page.getByRole("option", { name: /alfred/i }).click();
  await expect(page.getByText("Download alfred?")).toBeVisible();
  await page.getByRole("button", { name: "Download Model" }).click();
  await expect(page.getByText("Downloading alfred")).toBeVisible();
  await expect(page.getByText("alfred ready")).toBeVisible();
  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Runtime settings saved to runtime.env.")).toBeVisible();
  await expect(runtimeSettingsPanel.getByLabel("Suggestion Strategy")).toHaveValue("history-only");
  await expect(page.getByText("Model warmed up in 146ms")).toBeVisible();

  const pathRow = page.locator(".path-row").filter({ has: page.getByText("State dir") });
  await pathRow.hover();
  await pathRow.getByRole("button", { name: "Open State dir in Finder" }).click();
  await expect.poll(() => openPathCalls).toBe(1);
});

test("daemon runtime controls surface readiness and restart failures", async ({ page }) => {
  await page.route("**/api/runtime/start", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        health: {
          ok: true,
          modelName: "qwen2.5-coder:7b",
          socket: "/tmp/daemon.sock",
        },
        settings: {
          stateDir: "/tmp/lac",
          runtimeEnvPath: "/tmp/lac/runtime.env",
          socketPath: "/tmp/daemon.sock",
          dbPath: "/tmp/lac/autocomplete.sqlite",
          modelName: "qwen2.5-coder:7b",
          modelBaseUrl: "http://127.0.0.1:11434",
          suggestStrategy: "history+model",
          suggestTimeoutMs: 1200,
        },
        logPath: "/tmp/lac/daemon.log",
        pidPath: "/tmp/lac/daemon.pid",
        pid: 43210,
      }),
    });
  });

  await page.route("**/api/runtime/restart", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: "daemon failed to become healthy on /tmp/daemon.sock",
      }),
    });
  });

  await page.route("**/api/runtime", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        health: {
          ok: true,
          modelName: "qwen2.5-coder:7b",
          socket: "/tmp/daemon.sock",
        },
        settings: {
          stateDir: "/tmp/lac",
          runtimeEnvPath: "/tmp/lac/runtime.env",
          socketPath: "/tmp/daemon.sock",
          dbPath: "/tmp/lac/autocomplete.sqlite",
          modelName: "qwen2.5-coder:7b",
          modelBaseUrl: "http://127.0.0.1:11434",
          suggestStrategy: "history+model",
          suggestTimeoutMs: 1200,
        },
        logPath: "/tmp/lac/daemon.log",
        pidPath: "/tmp/lac/daemon.pid",
        pid: 43210,
        recentLog: "daemon ready",
      }),
    });
  });

  await page.goto("/daemon");

  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Daemon started.")).toBeVisible();
  await expect(page.getByText("Healthy")).toBeVisible();

  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.getByText("daemon failed to become healthy on /tmp/daemon.sock")).toBeVisible();
  await expect(page.getByText("Daemon restarted.")).toHaveCount(0);
});
