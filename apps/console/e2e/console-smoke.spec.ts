import { expect, test, type Page } from "@playwright/test";

function getDetailBlock(page: Page, heading: string) {
  return page.locator(".detail-block").filter({
    has: page.getByRole("heading", { name: heading }),
  });
}

async function mockEventSource(
  page: Page,
  streams: Array<{ match: string; messages: unknown[] }>,
) {
  await page.addInitScript(
    (definitions: Array<{ match: string; messages: unknown[] }>) => {
      class MockEventSource {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSED = 2;

        readonly url: string;
        readonly withCredentials = false;
        readyState = MockEventSource.CONNECTING;
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent<string>) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;

        constructor(url: string | URL) {
          this.url = String(url);
          const stream = definitions.find((entry) => this.url.includes(entry.match));

          window.setTimeout(() => {
            this.readyState = MockEventSource.OPEN;
            this.onopen?.(new Event("open"));

            for (const [index, payload] of (stream?.messages || []).entries()) {
              window.setTimeout(() => {
                if (this.readyState !== MockEventSource.OPEN) {
                  return;
                }
                this.onmessage?.(
                  { data: JSON.stringify(payload) } as MessageEvent<string>,
                );
              }, 30 * (index + 1));
            }
          }, 0);
        }

        addEventListener() {}

        removeEventListener() {}

        dispatchEvent() {
          return true;
        }

        close() {
          this.readyState = MockEventSource.CLOSED;
        }
      }

      (window as Window & { EventSource: typeof EventSource }).EventSource =
        MockEventSource as unknown as typeof EventSource;
    },
    streams,
  );
}

test("dashboard renders seeded overview data", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("llm-cli-suggestions Console").first()).toBeVisible();
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(page.locator(".app-shell.sidebar-collapsed")).toHaveCount(1);
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await expect(page.locator(".app-shell.sidebar-collapsed")).toHaveCount(0);
  await expect(page.getByText("Avg. latency")).toBeVisible();
  await expect(page.locator("strong").filter({ hasText: "178 ms" }).first()).toBeVisible();
  await expect(page.locator("strong").filter({ hasText: "58.3%" }).first()).toBeVisible();
  await expect(page.locator("strong").filter({ hasText: "35" }).first()).toBeVisible();
  await expect(page.getByText("git status").first()).toBeVisible();
  await expect(page.getByText("model suggestion for npm run t31")).toBeVisible();
  await expect(page.getByText("qwen2.5-coder:7b").first()).toBeVisible();
});

test("overview and daemon panels apply streamed updates", async ({ page }) => {
  await mockEventSource(page, [
    {
      match: "/api/overview/activity/stream",
      messages: [
        {
          signals: [
            {
              id: 9001,
              timestamp: "Mar 21, 2026, 10:19 p.m.",
              tone: "accepted",
              label: "ACCEPT",
              message: "model suggestion for open https://docs",
            },
          ],
        },
      ],
    },
    {
      match: "/api/runtime/log/stream",
      messages: [
        {
          log: "daemon ready\nstream attached\nflag provided but not defined: -strategy",
        },
      ],
    },
  ]);

  await page.goto("/");
  await expect(page.locator(".stream-indicator-live").first()).toBeVisible();
  await expect(page.getByText("model suggestion for open https://docs")).toBeVisible();

  await page.goto("/daemon");
  const logPanel = getDetailBlock(page, "Recent Daemon Log");
  await expect(page.locator(".stream-indicator-live").first()).toBeVisible();
  await expect(logPanel.getByText("stream attached")).toBeVisible();
});

test("suggestions and commands pages render seeded history", async ({ page }) => {
  await page.goto("/suggestions");

  await expect(page.getByRole("heading", { name: "Suggestions", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show Filters" }).click();
  await page.getByLabel("Query").fill("git st");
  await page.getByLabel("Outcome").selectOption("accepted");
  await page.getByRole("button", { name: "Apply Filters" }).click();

  await expect(page.getByText("git status").first()).toBeVisible();
  await expect(page.getByText("session-alpha").first()).toBeVisible();
  await expect(page.getByText("No suggestions matched the selected filters.")).toHaveCount(0);

  await page.goto("/commands");
  await expect(page.getByRole("heading", { name: "Commands & Feedback", exact: true })).toBeVisible();
  await expect(page.getByText("session-alpha").first()).toBeVisible();
  await expect(page.getByText("npm run build").first()).toBeVisible();
  await expect(page.getByText("git status").nth(0)).toBeVisible();
  await page.getByLabel("Query").fill("git");
  await page.getByRole("button", { name: "Apply Filters" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "git log --oneline -29" })).toBeVisible();
  await expect(page.getByText("77.8%", { exact: true })).toBeVisible();
  await expect(page.getByText("session-alpha").first()).toBeVisible();
  await expect(page.getByText("git status").nth(0)).toBeVisible();
  await expect(page.getByText("npm run build").first()).toHaveCount(0);
});

test("suggestions page supports sorting, pagination, structured context, and grading", async ({
  page,
}) => {
  await page.goto("/suggestions?sort=latency-desc&pageSize=25");

  await expect(page.getByText("Page 1")).toBeVisible();
  const firstDataRow = page.locator("tbody tr").first();
  await expect(firstDataRow).toContainText("npm run t31");

  await page.getByRole("link", { name: "2" }).click();
  await expect(page.getByText("Page 2")).toBeVisible();

  await page.goto("/suggestions?query=git%20commit%20-m");
  await page.getByRole("button", { name: "Show Filters" }).click();
  const gradedRow = page.locator("tbody tr").filter({
    has: page.getByText('git commit -m "ship console"'),
  });
  await gradedRow.getByRole("button", { name: "Good" }).click();
  await expect(gradedRow.getByRole("button", { name: "Clear" })).toBeVisible();

  await gradedRow.getByRole("button", { name: /no branch|main/i }).click();
  await expect(page.getByRole("heading", { name: "Retrieved Context", exact: true })).toBeVisible();
  const copyButton = page.getByRole("button", { name: /Copy Context|Copied/ });
  await expect(copyButton).toBeVisible();
  await expect(page.getByText("Suggestion ID", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy ID|Copied/ })).toBeVisible();

  await page.reload();
  const reloadedRow = page.locator("tbody tr").filter({
    has: page.getByText('git commit -m "ship console"'),
  });
  await expect(reloadedRow.getByRole("button", { name: "Clear" })).toBeVisible();

  await page.getByRole("button", { name: "Show Filters" }).click();
  await page.getByLabel("Quality Label").selectOption("good");
  await page.getByRole("button", { name: "Apply Filters" }).click();
  await expect(page.getByText('git commit -m "ship console"').first()).toBeVisible();
});

test("suggestions page shows a visual placeholder for empty buffers without adding DOM text", async ({
  page,
}) => {
  await page.goto("/suggestions?query=fixture%20empty%20buffer%20suggestion");

  const row = page.locator("tbody tr").filter({
    has: page.getByText("fixture empty buffer suggestion"),
  });
  const bufferCode = row.locator("td").nth(2).locator("code");

  await expect(bufferCode).toHaveText("");
  await expect
    .poll(async () => bufferCode.evaluate((element) => getComputedStyle(element, "::after").content))
    .toBe('"empty buffer"');
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
        retrieved_context: {
          current_token: "st",
          history_matches: ["git status", "git stash"],
          path_matches: ["src/", "scripts/"],
          git_branch_matches: ["stable"],
          project_task_matches: [],
        },
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
            retrieval: 10,
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
              retrieval: 10,
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
              retrieval: 0,
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

  await page.goto("/inspector");

  await expect(page.getByRole("heading", { name: "Inspector" })).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/ranking") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Inspect", exact: true }).click(),
  ]);

  await expect(page.getByText("Winning candidate")).toBeVisible();
  await expect(page.getByText("git status --short").first()).toBeVisible();
  await expect(page.getByText("mock prompt")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Retrieved Context", exact: true })).toBeVisible();
  await expect(page.getByText("src/")).toBeVisible();
  await expect(page.getByText("stable")).toBeVisible();
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

  await page.goto("/inspector");
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/ranking") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Inspect", exact: true }).click(),
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

  await page.goto("/inspector");

  const submit = page.getByRole("button", { name: "Inspect", exact: true });
  await page.getByLabel("Buffer").fill("");
  await expect(submit).toBeDisabled();
  await expect(page.getByText("Buffer is required.")).toBeVisible();

  await page.getByLabel("Buffer").fill("pnpm te");
  await page.getByLabel("Session ID").fill("ranking-session");
  await page.getByLabel("CWD").fill("/Users/simon/projects/web");
  await page.getByLabel("Last Exit Code").fill("17");
  await page.getByRole("textbox", { name: "Model", exact: true }).fill("mistral-small");
  await page.getByLabel("Suggestion Strategy").selectOption("model-only");
  await expect(
    page.getByText("Ignores history candidates and relies entirely on the model for suggestions.", {
      exact: false,
    }),
  ).toBeVisible();
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
    last_exit_code: 17,
    model_name: "mistral-small",
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

  await page.goto("/inspector");
  await page.getByLabel("Suggestion Strategy").selectOption("model-only");
  await page.getByLabel("Recent Commands").fill("git status\npnpm test\nnpm run dev");

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/ranking") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Inspect", exact: true }).click(),
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
        model_error:
          "qwen2.5-coder:7b timed out after 2s. Increase Suggest Timeout on the Daemon page or warm the model first.",
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

  await page.goto("/inspector");
  await page.getByLabel("Suggestion Strategy").selectOption("model-only");
  await page.getByLabel("Recent Commands").fill("git status\npnpm test\nnpm run dev");

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/ranking") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Inspect", exact: true }).click(),
  ]);

  await expect(page.getByText("No suggestion")).toBeVisible();
  await expect(
    page.getByText(
      "qwen2.5-coder:7b timed out after 2s. Increase Suggest Timeout on the Daemon page or warm the model first.",
    ),
  ).toBeVisible();
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

  await page.goto("/inspector");

  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(page.getByText("Winning candidate")).toBeVisible();
  await expect(page.getByText("git status").first()).toBeVisible();

  await page.getByLabel("Buffer").fill("broken");
  await page.getByRole("button", { name: "Inspect", exact: true }).click();

  await expect(page.getByText("daemon inspect failed")).toBeVisible();
  await expect(page.getByText("Winning candidate")).toHaveCount(0);
  await expect(page.getByText("first pass prompt")).toHaveCount(0);
});

test("model lab guardrails and defaults work with local fixtures", async ({ page }) => {
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
          modelKeepAlive: "5m",
          suggestStrategy: "history+model",
          systemPromptStatic: "",
          suggestTimeoutMs: 1200,
          ptyCaptureAllowlist: "",
        },
        logPath: "/tmp/lac/daemon.log",
        pidPath: "/tmp/lac/daemon.pid",
        pid: 12345,
        recentLog: "",
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
          { name: "mistral-small", installed: true, source: "installed" },
          { name: "phi4", installed: true, source: "installed" },
        ],
        installedCount: 3,
        libraryCount: 0,
      }),
    });
  });

  await page.goto("/lab");

  const benchmarkPanel = getDetailBlock(page, "Run Saved Benchmarks");
  const adHocPanel = getDetailBlock(page, "Ad-Hoc Model Test");

  await expect(
    page.locator(".compact-metrics").getByText("Current runtime model", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".compact-metrics").getByText("Saved strategy", { exact: true })).toBeVisible();
  await expect(page.getByText("qwen2.5-coder:7b").first()).toBeVisible();
  await expect(adHocPanel.getByLabel("Suggestion Strategy")).toHaveValue("history+model");
  await expect(benchmarkPanel.getByLabel("Models")).toHaveValue("");
  await expect(
    benchmarkPanel.getByRole("button", { name: "Queue Benchmark" }),
  ).toBeEnabled();

  await benchmarkPanel.getByLabel("Models").fill("phi");
  await expect(benchmarkPanel.getByRole("button", { name: "Add" })).toBeDisabled();
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
  await adHocPanel.getByLabel("Session ID").fill("session-alpha");
  await adHocPanel.getByRole("button", { name: "Reset Context" }).click();
  await expect(adHocPanel.getByLabel("Buffer")).toHaveValue("git st");
  await expect(adHocPanel.getByLabel("Session ID")).toHaveValue("");
  await expect(adHocPanel.getByLabel("Suggestion Strategy")).toHaveValue("history+model");
  await expect(adHocPanel.getByRole("button", { name: "Run Ad-Hoc Test" })).toBeEnabled();
});

test("model lab benchmark flow works with local fixtures", async ({ page }) => {
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
          modelKeepAlive: "5m",
          suggestStrategy: "history+model",
          systemPromptStatic: "",
          suggestTimeoutMs: 1200,
          ptyCaptureAllowlist: "",
        },
        logPath: "/tmp/lac/daemon.log",
        pidPath: "/tmp/lac/daemon.pid",
        pid: 12345,
        recentLog: "",
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
          { name: "mistral-small", installed: true, source: "installed" },
          { name: "phi4", installed: true, source: "installed" },
        ],
        installedCount: 3,
        libraryCount: 0,
      }),
    });
  });

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
            status: "running",
            models: ["qwen2.5-coder:7b", "mistral-small"],
            repeatCount: 2,
            timeoutMs: 5000,
            outputJsonPath: "/tmp/run-77.json",
            summary: {
              progress: {
                completed: 3,
                total: 18,
                percent: 17,
                status: "running",
                currentModel: "mistral-small",
                currentCase: "npm_dev_server",
                currentRun: 1,
              },
              models: {},
            },
            errorText: "",
            createdAtMs: Date.now(),
            startedAtMs: Date.now() - 2000,
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
          summary: {
            progress: {
              completed: 18,
              total: 18,
              percent: 100,
              status: "completed",
              currentModel: "mistral-small",
              currentCase: "npm_dev_server",
              currentRun: 2,
            },
            models: {
              "mistral-small": {
                total: 9,
                validPrefixRate: 0.88,
                acceptedRate: 0.66,
                avgLatencyMs: 192,
              },
              "qwen2.5-coder:7b": {
                total: 9,
                validPrefixRate: 1,
                acceptedRate: 0.77,
                avgLatencyMs: 174,
              },
            },
          },
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
  const benchmarkModelInput = benchmarkPanel.getByRole("textbox", { name: "Models", exact: true });
  await benchmarkPanel.getByLabel("Models").click();
  await benchmarkPanel
    .getByRole("option", { name: /mistral-small.*installed/i })
    .first()
    .click();
  await expect(benchmarkModelInput).toHaveValue("");
  await expect(benchmarkPanel.getByText("mistral-small")).toBeVisible();
  await benchmarkModelInput.fill("llama3");
  await expect(benchmarkPanel.getByRole("button", { name: "Add" })).toBeDisabled();
  await benchmarkModelInput.fill("llama3.2:latest");
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
  await expect(page.getByText("1 benchmark run active")).toBeVisible();
  await expect(page.getByText("3/18")).toBeVisible();

  const queuedRunRow = page.locator("tr").filter({ has: page.getByRole("cell", { name: "#77" }) });
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/benchmarks/77") && response.request().method() === "GET",
    ),
    queuedRunRow.getByRole("button", { name: "View" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Benchmark Run #77" })).toBeVisible();
  await expect(page.getByText("18/18 benchmark checks complete")).toBeVisible();
  await expect(page.getByText("Avg. latency").first()).toBeVisible();
  await expect(page.getByText("git status --short")).toBeVisible();
  await page.getByRole("button", { name: "Close Run" }).click();
  await expect(page.getByRole("heading", { name: "Benchmark Run #77" })).toHaveCount(0);
});

test("model lab benchmark runs fail early and preserve partial results", async ({ page }) => {
  let benchmarkListRequests = 0;

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
        pid: 12345,
        recentLog: "",
      }),
    });
  });

  await page.route("**/api/benchmarks/run", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        runId: 88,
      }),
    });
  });

  await page.route("**/api/benchmarks", async (route) => {
    benchmarkListRequests += 1;
    const failedRun = {
      id: 88,
      status: "failed",
      models: ["nemotron-mini:4b", "qwen3-coder:latest"],
      repeatCount: 4,
      timeoutMs: 5000,
      outputJsonPath: "/tmp/run-88.json",
      summary: {
        progress: {
          completed: 1,
          total: 72,
          percent: 1,
          status: "failed",
          currentModel: "nemotron-mini:4b",
          currentCase: "docker_compose_logs",
          currentRun: 1,
        },
        models: {
          "nemotron-mini:4b": {
            total: 1,
            validPrefixRate: 0,
            acceptedRate: 0,
            avgLatencyMs: 5000,
          },
        },
      },
      errorText:
        "benchmark failed early: model nemotron-mini:4b failed on docker_compose_logs run 1: call ollama: Post \"http://127.0.0.1:11434/api/generate\": context deadline exceeded",
      createdAtMs: Date.now(),
      startedAtMs: Date.now() - 2000,
      finishedAtMs: Date.now() - 1000,
    };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          benchmarkListRequests === 1
            ? {
                ...failedRun,
                status: "running",
                summary: {
                  progress: {
                    completed: 0,
                    total: 72,
                    percent: 0,
                    status: "running",
                    currentModel: "",
                    currentCase: "",
                    currentRun: 0,
                  },
                  models: {},
                },
                errorText: "",
                finishedAtMs: 0,
              }
            : failedRun,
        ],
      }),
    });
  });

  await page.route("**/api/benchmarks/88", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run: {
          id: 88,
          status: "failed",
          models: ["nemotron-mini:4b", "qwen3-coder:latest"],
          repeatCount: 4,
          timeoutMs: 5000,
          outputJsonPath: "/tmp/run-88.json",
          summary: {
            progress: {
              completed: 1,
              total: 72,
              percent: 1,
              status: "failed",
              currentModel: "nemotron-mini:4b",
              currentCase: "docker_compose_logs",
              currentRun: 1,
            },
            models: {
              "nemotron-mini:4b": {
                total: 1,
                validPrefixRate: 0,
                acceptedRate: 0,
                avgLatencyMs: 5000,
              },
            },
          },
          errorText:
            "benchmark failed early: model nemotron-mini:4b failed on docker_compose_logs run 1: call ollama: Post \"http://127.0.0.1:11434/api/generate\": context deadline exceeded",
          createdAtMs: Date.now(),
          startedAtMs: Date.now() - 2000,
          finishedAtMs: Date.now() - 1000,
        },
        results: [
          {
            id: 8801,
            runId: 88,
            modelName: "nemotron-mini:4b",
            caseName: "docker_compose_logs",
            runNumber: 1,
            latencyMs: 5000,
            suggestionText: "",
            validPrefix: false,
            accepted: false,
            errorText:
              "call ollama: Post \"http://127.0.0.1:11434/api/generate\": context deadline exceeded",
            createdAtMs: Date.now(),
          },
        ],
      }),
    });
  });

  await page.goto("/lab");

  const benchmarkPanel = getDetailBlock(page, "Run Saved Benchmarks");
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/benchmarks/run") && response.request().method() === "POST",
    ),
    benchmarkPanel.getByRole("button", { name: "Queue Benchmark" }).click(),
  ]);

  await expect(page.getByText("Benchmark queued as run #88.")).toBeVisible();
  await expect(page.getByText("1 benchmark run active")).toBeVisible();
  await expect.poll(() => benchmarkListRequests).toBeGreaterThan(1);
  await expect(page.getByRole("cell", { name: "#88" })).toBeVisible();
  await expect(page.getByText("failed").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Benchmark Run #88" })).toBeVisible();
  await expect(page.getByText("1/72 benchmark checks complete")).toBeVisible();
  await expect(page.getByText(/benchmark failed early:/)).toBeVisible();
  await expect(page.getByText("docker_compose_logs").first()).toBeVisible();
  await expect(page.getByText(/context deadline exceeded/).first()).toBeVisible();
});

test("model lab ad-hoc flow works with local fixtures", async ({ page }) => {
  let rankingRequestCount = 0;
  const seenStrategies = new Set<string>();
  const capturedPayloads: Array<Record<string, unknown>> = [];

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
          modelKeepAlive: "5m",
          suggestStrategy: "history+model",
          systemPromptStatic: "",
          suggestTimeoutMs: 1200,
          ptyCaptureAllowlist: "",
        },
        logPath: "/tmp/lac/daemon.log",
        pidPath: "/tmp/lac/daemon.pid",
        pid: 12345,
        recentLog: "",
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
          { name: "mistral-small", installed: true, source: "installed" },
          { name: "phi4", installed: true, source: "installed" },
        ],
        installedCount: 3,
        libraryCount: 0,
      }),
    });
  });

  await page.route("**/api/ranking", async (route) => {
    rankingRequestCount += 1;
    const payload = route.request().postDataJSON() as {
      model_name?: string;
      recent_commands?: string[];
      strategy?: string;
    };
    capturedPayloads.push(payload as Record<string, unknown>);
    const modelName = payload.model_name || "unknown";
    seenStrategies.add(payload.strategy || "");

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
  const adHocModelInput = adHocPanel.getByRole("textbox", { name: "Models", exact: true });
  await adHocPanel.getByLabel("Models").click();
  await adHocPanel.getByRole("option", { name: /phi4/i }).click();
  await expect(adHocModelInput).toHaveValue("");
  await expect(adHocPanel.getByText("phi4")).toBeVisible();
  await adHocModelInput.fill("mistral");
  await expect(adHocPanel.getByRole("button", { name: "Add" })).toBeDisabled();
  await adHocModelInput.fill("mistral-small");
  await adHocPanel.getByRole("button", { name: "Add" }).click();
  await expect(adHocPanel.getByText("mistral-small")).toBeVisible();
  await adHocPanel.getByLabel("Suggestion Strategy").selectOption("model-only");
  await adHocPanel.getByLabel("Session ID").fill("lab-session");
  await adHocPanel.getByLabel("CWD").fill("/Users/simon/projects/gleamery");
  await adHocPanel.getByLabel("Last Exit Code").fill("9");
  await adHocPanel.getByLabel("Recent Commands").fill("git fetch\npnpm test");

  await adHocPanel.getByRole("button", { name: "Run Ad-Hoc Test" }).click();
  await expect.poll(() => rankingRequestCount).toBe(3);
  expect(seenStrategies.has("model-only")).toBe(true);
  for (const payload of capturedPayloads) {
    expect(payload).toMatchObject({
      session_id: "lab-session",
      cwd: "/Users/simon/projects/gleamery",
      last_exit_code: 9,
      strategy: "model-only",
      recent_commands: ["git fetch", "pnpm test"],
      limit: 6,
    });
    expect(payload).not.toHaveProperty("repo_root");
    expect(payload).not.toHaveProperty("branch");
    expect(payload).not.toHaveProperty("model_base_url");
  }

  await expect(page.getByRole("heading", { name: "Ad-Hoc Results" })).toBeVisible();
  await expect(page.getByText("Compared 3 models")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Best Suggestion" })).toBeVisible();
  await expect(page.getByText("phi4 used recent commands")).toBeVisible();
  await expect(page.getByText('git commit -m "ship console"').first()).toBeVisible();

  await adHocPanel.getByRole("button", { name: "Clear Results" }).click();
  await expect(page.getByRole("heading", { name: "Ad-Hoc Results" })).toHaveCount(0);
});

test("daemon runtime settings and downloads work with local fixtures", async ({ page }) => {
  let installPollCount = 0;
  let openPathCalls = 0;
  let savedSuggestStrategy = "history+model";
  let savedModelName = "qwen2.5-coder:7b";
  let savedSystemPromptStatic = "";
  let savedModelKeepAlive = "5m";
  let savedAcceptKey = "tab";
  let savedPtyCaptureMode = "allowlist";
  let savedPtyCaptureAllowlist = "";
  let savedPtyCaptureBlocklist = "";
  let phi4Installed = false;

  await page.route("**/api/runtime/settings", async (route) => {
    const payload = route.request().postDataJSON() as {
      LAC_MODEL_NAME?: string;
      LAC_SUGGEST_STRATEGY?: string;
      LAC_MODEL_KEEP_ALIVE?: string;
      LAC_SYSTEM_PROMPT_STATIC?: string;
      LAC_ACCEPT_KEY?: string;
      LAC_PTY_CAPTURE_MODE?: string;
      LAC_PTY_CAPTURE_ALLOWLIST?: string;
      LAC_PTY_CAPTURE_BLOCKLIST?: string;
    };
    savedModelName = payload.LAC_MODEL_NAME || savedModelName;
    savedSuggestStrategy = payload.LAC_SUGGEST_STRATEGY || savedSuggestStrategy;
    savedModelKeepAlive = payload.LAC_MODEL_KEEP_ALIVE || savedModelKeepAlive;
    savedSystemPromptStatic = payload.LAC_SYSTEM_PROMPT_STATIC || savedSystemPromptStatic;
    savedAcceptKey = payload.LAC_ACCEPT_KEY || savedAcceptKey;
    savedPtyCaptureMode = payload.LAC_PTY_CAPTURE_MODE || savedPtyCaptureMode;
    savedPtyCaptureAllowlist = payload.LAC_PTY_CAPTURE_ALLOWLIST || savedPtyCaptureAllowlist;
    savedPtyCaptureBlocklist = payload.LAC_PTY_CAPTURE_BLOCKLIST || savedPtyCaptureBlocklist;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stateDir: "/tmp/lac",
        runtimeEnvPath: "/tmp/lac/runtime.env",
        socketPath: "/tmp/daemon.sock",
        dbPath: "/tmp/lac/autocomplete.sqlite",
        modelName: savedModelName,
        modelBaseUrl: "http://127.0.0.1:11434",
        modelKeepAlive: savedModelKeepAlive,
        suggestStrategy: savedSuggestStrategy,
        systemPromptStatic: savedSystemPromptStatic,
        suggestTimeoutMs: 1200,
        acceptKey: savedAcceptKey,
        ptyCaptureMode: savedPtyCaptureMode,
        ptyCaptureAllowlist: savedPtyCaptureAllowlist,
        ptyCaptureBlocklist: savedPtyCaptureBlocklist,
      }),
    });
  });

  await page.route("**/api/runtime/restart", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        health: {
          ok: true,
          modelName: savedModelName,
          socket: "/tmp/daemon.sock",
        },
        settings: {
          stateDir: "/tmp/lac",
          runtimeEnvPath: "/tmp/lac/runtime.env",
          socketPath: "/tmp/daemon.sock",
          dbPath: "/tmp/lac/autocomplete.sqlite",
          modelName: savedModelName,
          modelBaseUrl: "http://127.0.0.1:11434",
          modelKeepAlive: savedModelKeepAlive,
          suggestStrategy: savedSuggestStrategy,
          systemPromptStatic: savedSystemPromptStatic,
          suggestTimeoutMs: 1200,
          acceptKey: savedAcceptKey,
          ptyCaptureMode: savedPtyCaptureMode,
          ptyCaptureAllowlist: savedPtyCaptureAllowlist,
          ptyCaptureBlocklist: savedPtyCaptureBlocklist,
        },
        logPath: "/tmp/lac/daemon.log",
        pidPath: "/tmp/lac/daemon.pid",
        pid: 43210,
        memory: {
          daemonRssBytes: 134217728,
          modelLoadedBytes: null,
          modelVramBytes: null,
          totalTrackedBytes: 134217728,
          modelName: savedModelName,
        },
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
          modelName: savedModelName,
          socket: "/tmp/daemon.sock",
        },
        settings: {
          stateDir: "/tmp/lac",
          runtimeEnvPath: "/tmp/lac/runtime.env",
          socketPath: "/tmp/daemon.sock",
          dbPath: "/tmp/lac/autocomplete.sqlite",
          modelName: savedModelName,
          modelBaseUrl: "http://127.0.0.1:11434",
          modelKeepAlive: savedModelKeepAlive,
          suggestStrategy: savedSuggestStrategy,
          systemPromptStatic: savedSystemPromptStatic,
          suggestTimeoutMs: 1200,
          acceptKey: savedAcceptKey,
          ptyCaptureMode: savedPtyCaptureMode,
          ptyCaptureAllowlist: savedPtyCaptureAllowlist,
          ptyCaptureBlocklist: savedPtyCaptureBlocklist,
        },
        logPath: "/tmp/lac/daemon.log",
        pidPath: "/tmp/lac/daemon.pid",
        pid: 43210,
        recentLog: "Model warmed up in 146ms",
        memory: {
          daemonRssBytes: 134217728,
          modelLoadedBytes: null,
          modelVramBytes: null,
          totalTrackedBytes: 134217728,
          modelName: savedModelName,
        },
      }),
    });
  });

  await page.route("**/api/runtime/log?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        log: "Model warmed up in 146ms",
      }),
    });
  });

  await page.route("**/api/ollama/install", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        job: {
          id: "install-phi4",
          model: "phi4",
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

  await page.route("**/api/ollama/install/install-phi4", async (route) => {
    installPollCount += 1;
    const isComplete = installPollCount > 1;
    if (isComplete) {
      phi4Installed = true;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        job: {
          id: "install-phi4",
          model: "phi4",
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
          { name: "phi4", installed: phi4Installed, source: phi4Installed ? "installed" : "library" },
        ],
        installedCount: phi4Installed ? 4 : 3,
        libraryCount: phi4Installed ? 0 : 1,
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
  await expect(page.getByRole("heading", { name: "Daemon", exact: true })).toBeVisible();
  const detailHeadings = await page.locator(".detail-block h3").allTextContents();
  expect(detailHeadings.indexOf("Recent Daemon Log")).toBeLessThan(
    detailHeadings.indexOf("Danger Zone"),
  );
  await page.getByRole("button", { name: "Refresh Log" }).click();
  await expect(page.getByText("Model warmed up in 146ms")).toBeVisible();
  const runtimeSettingsPanel = getDetailBlock(page, "Runtime Settings");
  const runtimeDetailsPanel = getDetailBlock(page, "Runtime Details");
  await expect(runtimeSettingsPanel.getByLabel("Model Name")).toHaveValue("qwen2.5-coder:7b");
  await expect(runtimeSettingsPanel.locator(".chip-list")).toHaveCount(0);
  await expect(runtimeSettingsPanel.getByLabel("Model Base URL")).toHaveCount(0);
  await expect(runtimeSettingsPanel.getByLabel("Socket Path")).toHaveCount(0);
  await expect(runtimeSettingsPanel.getByLabel("Database Path")).toHaveCount(0);
  await expect(runtimeDetailsPanel.getByText("Model Base URL")).toBeVisible();
  await expect(runtimeDetailsPanel.getByText("http://127.0.0.1:11434")).toBeVisible();
  await expect(runtimeDetailsPanel.getByText("Socket Path")).toBeVisible();
  await expect(runtimeDetailsPanel.getByText("Database Path")).toBeVisible();
  await expect(runtimeSettingsPanel.getByLabel("Suggestion Strategy")).toHaveValue("history+model");
  await expect(runtimeSettingsPanel.getByLabel("Accept Suggestion Key")).toHaveValue("tab");
  await expect(runtimeSettingsPanel.locator("textarea").nth(1)).toHaveAttribute(
    "placeholder",
    "git\n/^npm (run|test)$/",
  );
  await runtimeSettingsPanel.getByLabel("System Prompt").fill("Always prefer concise safe commands.");
  await runtimeSettingsPanel.getByLabel("Suggestion Strategy").selectOption("history-only");
  await runtimeSettingsPanel.getByLabel("Accept Suggestion Key").selectOption("right-arrow");
  await expect(
    runtimeSettingsPanel.getByText(
      "Tab returns to normal completion and Right Arrow accepts the suggestion only when one is visible",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    runtimeSettingsPanel.getByText(
      "Enter one command name or /regex/ per line. Plain lines match the executable name, while regex lines match the full command text.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    runtimeSettingsPanel.getByText(
      "complex interactive CLI tools can get confused by it",
      { exact: false },
    ),
  ).toBeVisible();
  await runtimeSettingsPanel.getByRole("button", { name: "Blocklist" }).click();
  await runtimeSettingsPanel.getByText("PTY Capture Block List", { exact: true }).click();
  await expect(runtimeSettingsPanel.getByRole("button", { name: "Blocklist" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(runtimeSettingsPanel.getByRole("button", { name: "Allowlist" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(runtimeSettingsPanel.locator("textarea").nth(1)).toHaveAttribute(
    "placeholder",
    "vim\n/^codex$/",
  );
  await expect(
    runtimeSettingsPanel.getByText(
      "Use the block list when the lightweight PTY shell can mess up complex interactive CLI tools.",
      { exact: false },
    ),
  ).toBeVisible();
  await runtimeSettingsPanel.locator("textarea").nth(1).fill("vim\n/^codex$/");
  await expect(
    runtimeSettingsPanel.getByText(
      "Uses past command history only. Fastest and closest to classic terminal autosuggestions.",
      { exact: false },
    ),
  ).toBeVisible();
  await runtimeSettingsPanel.getByLabel("Model Name").fill("phi4");
  await runtimeSettingsPanel.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Download phi4?")).toBeVisible();
  await page.getByRole("button", { name: "Download Model" }).click();
  await expect(page.getByText("phi4 ready")).toBeVisible();
  await expect(page.getByText("phi4 downloaded. Runtime settings saved and applied.")).toBeVisible();
  expect(savedAcceptKey).toBe("right-arrow");
  expect(savedPtyCaptureMode).toBe("blocklist");
  expect(savedPtyCaptureBlocklist).toBe("vim\n/^codex$/");
  await expect(runtimeSettingsPanel.getByLabel("Suggestion Strategy")).toHaveValue("history-only");
  await expect(runtimeSettingsPanel.getByLabel("Accept Suggestion Key")).toHaveValue("right-arrow");
  await expect(runtimeSettingsPanel.getByLabel("System Prompt")).toHaveValue(
    "Always prefer concise safe commands.",
  );
  await expect(page.getByText("Model warmed up in 146ms")).toBeVisible();

  await page.reload();
  await expect(runtimeSettingsPanel.getByLabel("Model Name")).toHaveValue("phi4");
  await expect(runtimeSettingsPanel.getByLabel("Suggestion Strategy")).toHaveValue("history-only");
  await expect(runtimeSettingsPanel.getByLabel("Accept Suggestion Key")).toHaveValue("right-arrow");
  await expect(runtimeSettingsPanel.getByLabel("System Prompt")).toHaveValue(
    "Always prefer concise safe commands.",
  );
  await expect(runtimeSettingsPanel.getByRole("button", { name: "Blocklist" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(runtimeSettingsPanel.locator("textarea").nth(1)).toHaveValue(
    "vim\n/^codex$/",
  );

  const pathRow = page.locator(".path-row").filter({ has: page.getByText("State dir") });
  await pathRow.hover();
  await pathRow.getByRole("button", { name: "Open State dir in Finder" }).click();
  await expect.poll(() => openPathCalls).toBe(1);
});

test("models page manages installed and downloadable Ollama models", async ({ page }) => {
  let gemmaInstalled = false;
  let phiInstalled = false;
  let llamaInstalled = true;
  const extraLibraryModels = Array.from({ length: 28 }, (_, index) => ({
    name: `catalog-model-${String(index + 1).padStart(2, "0")}`,
    installed: false,
    source: "library" as const,
  }));
  type MockJob = {
    id: string;
    action: "install" | "remove";
    model: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    message: string;
    progressPercent: number;
    completed: number;
    total: number;
    error: string;
    startedAtMs: number;
    updatedAtMs: number;
    finishedAtMs: number;
    polls: number;
    targetPolls: number;
  };
  const jobs = new Map<string, MockJob>();

  jobs.set("stalled-download:latest", {
    id: "install-stalled-download-latest",
    action: "install",
    model: "stalled-download:latest",
    status: "running",
    message: "pulling layers",
    progressPercent: 36,
    completed: 36,
    total: 100,
    error: "",
    startedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    finishedAtMs: 0,
    polls: 0,
    targetPolls: 999,
  });

  function serializeJob(job: MockJob) {
    return {
      id: job.id,
      action: job.action,
      model: job.model,
      status: job.status,
      message: job.message,
      progressPercent: job.progressPercent,
      completed: job.completed,
      total: job.total,
      error: job.error,
      startedAtMs: job.startedAtMs,
      updatedAtMs: job.updatedAtMs,
      finishedAtMs: job.finishedAtMs,
    };
  }

  function advanceJobs() {
    for (const job of jobs.values()) {
      if (
        job.status === "completed" ||
        job.status === "failed" ||
        job.status === "cancelled"
      ) {
        continue;
      }

      job.status = "running";
      job.polls += 1;
      job.updatedAtMs = Date.now();

      if (job.polls >= job.targetPolls) {
        job.status = "completed";
        job.progressPercent = 100;
        job.completed = job.total;
        job.finishedAtMs = Date.now();
        job.message = job.action === "install" ? "Download complete" : "Removal complete";

        if (job.model === "gemma3:4b") {
          gemmaInstalled = true;
        }
        if (job.model === "phi4") {
          phiInstalled = true;
        }
        if (job.model === "llama3.2:latest") {
          llamaInstalled = false;
        }
        continue;
      }

      const step = Math.min(92, 18 + job.polls * 28);
      job.progressPercent = step;
      job.completed = step;
      job.message = job.action === "install" ? "pulling layers" : "removing local layers";
    }
  }

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

  await page.route("**/api/ollama/models?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          { name: "qwen2.5-coder:7b", installed: true, source: "installed" },
          {
            name: "llama3.2:latest",
            installed: llamaInstalled,
            source: llamaInstalled ? "installed" : "library",
          },
          {
            name: "gemma3:4b",
            installed: gemmaInstalled,
            source: gemmaInstalled ? "installed" : "library",
            capabilities: ["vision", "tools"],
          },
          {
            name: "phi4",
            installed: phiInstalled,
            source: phiInstalled ? "installed" : "library",
          },
          ...extraLibraryModels,
        ],
        installedCount: 1 + Number(llamaInstalled) + Number(gemmaInstalled) + Number(phiInstalled),
        libraryCount:
          Number(!llamaInstalled) +
          Number(!gemmaInstalled) +
          Number(!phiInstalled) +
          extraLibraryModels.length,
        remoteLibraryCount: 0,
      }),
    });
  });

  await page.route("**/api/ollama/operations*", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as {
        jobId?: string;
        action?: "cancel" | "dismiss";
      };
      const entry = payload.jobId ? [...jobs.values()].find((job) => job.id === payload.jobId) : null;

      if (payload.action === "cancel" && entry) {
        entry.status = "cancelled";
        entry.message = entry.action === "install" ? "Download cancelled" : "Removal cancelled";
        entry.finishedAtMs = Date.now();
        entry.updatedAtMs = entry.finishedAtMs;
      }

      if (payload.action === "dismiss" && entry && entry.status !== "running" && entry.status !== "pending") {
        jobs.delete(entry.model);
      }

      await route.fulfill({
        status: entry || payload.action === "dismiss" ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify({
          jobs: [...jobs.values()]
            .filter((job) => job.status !== "completed")
            .map(serializeJob),
        }),
      });
      return;
    }

    advanceJobs();
    for (const job of [...jobs.values()]) {
      if (job.status === "completed") {
        jobs.delete(job.model);
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobs: [...jobs.values()].map(serializeJob),
      }),
    });
  });

  await page.route("**/api/ollama/install", async (route) => {
    const payload = route.request().postDataJSON() as { model?: string };
    const model = payload.model || "unknown";
    const existing = jobs.get(model);
    if (!existing) {
      jobs.set(model, {
        id: `install-${model.replace(/[^a-z0-9]+/gi, "-")}`,
        action: "install",
        model,
        status: "running",
        message: "pulling manifest",
        progressPercent: 14,
        completed: 14,
        total: 100,
        error: "",
        startedAtMs: Date.now(),
        updatedAtMs: Date.now(),
        finishedAtMs: 0,
        polls: 0,
        targetPolls: 4,
      });
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        job: serializeJob(jobs.get(model)!),
      }),
    });
  });

  await page.route("**/api/ollama/remove", async (route) => {
    const payload = route.request().postDataJSON() as { model?: string };
    const model = payload.model || "unknown";
    if (!jobs.has(model)) {
      jobs.set(model, {
        id: `remove-${model.replace(/[^a-z0-9]+/gi, "-")}`,
        action: "remove",
        model,
        status: "running",
        message: "removing local layers",
        progressPercent: 12,
        completed: 12,
        total: 100,
        error: "",
        startedAtMs: Date.now(),
        updatedAtMs: Date.now(),
        finishedAtMs: 0,
        polls: 0,
        targetPolls: 2,
      });
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ job: serializeJob(jobs.get(model)!) }),
    });
  });

  await page.goto("/models");
  await expect(page.getByRole("heading", { name: "Models" })).toBeVisible();
  await expect(page.getByText("qwen2.5-coder:7b").first()).toBeVisible();

  const qwenRow = page.locator(".model-catalog-item").filter({
    has: page.getByText("qwen2.5-coder:7b"),
  });
  await expect(qwenRow.getByRole("button", { name: "Remove" })).toBeDisabled();

  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await expect(page.getByText("catalog-model-01")).toBeVisible();
  await expect(page.getByText("catalog-model-25")).toHaveCount(0);
  await page
    .locator(".detail-block")
    .filter({ has: page.getByRole("heading", { name: "Available From Ollama" }) })
    .getByRole("button", { name: "Next" })
    .first()
    .click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await expect(page.getByText("catalog-model-25")).toBeVisible();
  await page.getByRole("textbox", { name: "Search" }).fill("gemma");
  await expect(page.getByText("vision")).toBeVisible();
  await expect(page.getByText("tools")).toBeVisible();

  const downloadBlock = getDetailBlock(page, "Download Model");
  const installedBlock = getDetailBlock(page, "Installed Locally");
  await downloadBlock.getByLabel("Model").fill("gemma");
  await page.getByRole("option", { name: /gemma3:4b/i }).click();
  await downloadBlock.getByRole("button", { name: "Download", exact: true }).click();
  await downloadBlock.getByLabel("Model").fill("phi");
  await page.getByRole("option", { name: /phi4/i }).click();
  await downloadBlock.getByRole("button", { name: "Download", exact: true }).click();
  await expect(installedBlock.getByText("Model Operations")).toBeVisible();
  await expect(installedBlock.getByText("Download stalled-download:latest")).toBeVisible();
  await expect(installedBlock.getByText("Download gemma3:4b")).toBeVisible();
  await expect(installedBlock.getByText("Download phi4")).toBeVisible();

  await page.reload();
  await expect(installedBlock.getByText("Download stalled-download:latest")).toBeVisible();
  await expect.poll(async () => {
    return await installedBlock.locator(".model-catalog-item code").filter({
      hasText: "gemma3:4b",
    }).count();
  }).toBe(1);
  await expect.poll(async () => {
    return await installedBlock.locator(".model-catalog-item code").filter({
      hasText: "phi4",
    }).count();
  }).toBe(1);
  await expect(installedBlock.getByText("Download gemma3:4b")).toHaveCount(0);
  await expect(installedBlock.getByText("Download phi4")).toHaveCount(0);

  const stalledOperation = installedBlock.locator(".model-operation-item").filter({
    has: page.getByText("Download stalled-download:latest"),
  });
  await stalledOperation.getByRole("button", { name: "Cancel" }).click();
  await expect(stalledOperation.getByRole("button", { name: "Dismiss" })).toBeVisible();
  await stalledOperation.getByRole("button", { name: "Dismiss" }).click();
  await expect(stalledOperation).toHaveCount(0);

  await page.getByRole("textbox", { name: "Search" }).fill("");

  const llamaRow = installedBlock.locator(".model-catalog-item").filter({
    has: page.getByText("llama3.2:latest"),
  });
  await llamaRow.getByRole("button", { name: "Remove" }).click();
  await expect(installedBlock.getByText("Removal llama3.2:latest")).toBeVisible();
  await expect.poll(async () => await llamaRow.count()).toBe(0);
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
          modelKeepAlive: "5m",
          suggestStrategy: "history+model",
          systemPromptStatic: "",
          suggestTimeoutMs: 1200,
          ptyCaptureAllowlist: "",
        },
        logPath: "/tmp/lac/daemon.log",
        pidPath: "/tmp/lac/daemon.pid",
        pid: 43210,
        memory: {
          daemonRssBytes: 134217728,
          modelLoadedBytes: null,
          modelVramBytes: null,
          totalTrackedBytes: 134217728,
          modelName: "qwen2.5-coder:7b",
        },
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
          modelKeepAlive: "5m",
          suggestStrategy: "history+model",
          systemPromptStatic: "",
          suggestTimeoutMs: 1200,
          ptyCaptureAllowlist: "",
        },
        logPath: "/tmp/lac/daemon.log",
        pidPath: "/tmp/lac/daemon.pid",
        pid: 43210,
        recentLog: "daemon ready",
        memory: {
          daemonRssBytes: 134217728,
          modelLoadedBytes: null,
          modelVramBytes: null,
          totalTrackedBytes: 134217728,
          modelName: "qwen2.5-coder:7b",
        },
      }),
    });
  });

  await page.goto("/daemon");

  await expect(page.getByText("Healthy")).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Daemon started.")).toBeVisible();
  await expect(page.getByText("Healthy")).toBeVisible();

  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.getByText("daemon failed to become healthy on /tmp/daemon.sock")).toBeVisible();
  await expect(page.getByText("Daemon restarted.")).toHaveCount(0);
});
