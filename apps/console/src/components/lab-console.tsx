"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { PathHoverActions } from "@/components/path-hover-actions";
import { SuggestStrategyField } from "@/components/suggest-strategy-field";
import { formatDurationMs, formatTimestamp } from "@/lib/format";
import type {
  BenchmarkResultRow,
  BenchmarkRunRow,
  OllamaModelOption,
  SuggestStrategy,
} from "@/lib/types";

type RankingResponse = {
  model_name: string;
  winner: { command: string; source: string } | null;
  cleaned_model_output: string;
  raw_model_output: string;
  candidates: Array<{ command: string; source: string; score: number }>;
};

interface LabConsoleProps {
  initialRuns: BenchmarkRunRow[];
  defaultModel: string;
  defaultSuggestStrategy: SuggestStrategy;
  availableModels: OllamaModelOption[];
  inventorySummary: {
    installedCount: number;
    libraryCount: number;
    installedError?: string;
    libraryError?: string;
  };
}

export function LabConsole({
  initialRuns,
  defaultModel,
  defaultSuggestStrategy,
  availableModels,
  inventorySummary,
}: LabConsoleProps) {
  const [runtimeDefaults, setRuntimeDefaults] = useState({
    model: defaultModel,
    suggestStrategy: defaultSuggestStrategy,
  });
  const [runs, setRuns] = useState(initialRuns);
  const [selectedRun, setSelectedRun] = useState<{
    run: BenchmarkRunRow;
    results: BenchmarkResultRow[];
  } | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [runForm, setRunForm] = useState({
    models: [defaultModel],
    repeatCount: "2",
    timeoutMs: "5000",
  });
  const [testForm, setTestForm] = useState({
    models: [defaultModel],
    sessionId: "",
    buffer: "git st",
    cwd: "",
    recentCommands: "",
    lastExitCode: "",
    suggestStrategy: defaultSuggestStrategy,
  });
  const [runModelInput, setRunModelInput] = useState("");
  const [testModelInput, setTestModelInput] = useState("");
  const [testResults, setTestResults] = useState<RankingResponse[]>([]);
  const [loadingRun, setLoadingRun] = useState(false);
  const [loadingRunId, setLoadingRunId] = useState<number | null>(null);
  const [loadingTest, setLoadingTest] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const normalizedRunModels = useMemo(
    () => runForm.models.map((value) => value.trim()).filter(Boolean),
    [runForm.models],
  );
  const normalizedTestModels = useMemo(
    () => testForm.models.map((value) => value.trim()).filter(Boolean),
    [testForm.models],
  );
  const canQueueBenchmark = normalizedRunModels.length > 0 && !loadingRun;
  const canRunAdHoc =
    normalizedTestModels.length > 0 && testForm.buffer.trim().length > 0 && !loadingTest;
  const activeRuns = useMemo(
    () => runs.filter((run) => run.status === "queued" || run.status === "running"),
    [runs],
  );

  const selectedRunMeta =
    (selectedRunId !== null ? runs.find((run) => run.id === selectedRunId) : null) ||
    selectedRun?.run ||
    null;

  function parseRunSummary(summary: Record<string, unknown> | null) {
    if (!summary) {
      return {
        progress: null as null | {
          completed: number;
          total: number;
          percent: number;
          status: string;
          currentModel: string;
          currentCase: string;
          currentRun: number;
        },
        models: [] as Array<{
          modelName: string;
          total: number;
          validPrefixRate: number;
          acceptedRate: number;
          avgLatencyMs: number;
        }>,
      };
    }

    const progressSource =
      "progress" in summary && summary.progress && typeof summary.progress === "object"
        ? (summary.progress as Record<string, unknown>)
        : null;

    const modelsSource =
      "models" in summary && summary.models && typeof summary.models === "object"
        ? (summary.models as Record<string, unknown>)
        : summary;

    const models = Object.entries(modelsSource)
      .filter((entry) => entry[0] !== "progress")
      .map(([modelName, value]) => {
        const parsed = value as Record<string, unknown>;
        return {
          modelName,
          total: Number(parsed.total || 0),
          validPrefixRate: Number(parsed.validPrefixRate || 0),
          acceptedRate: Number(parsed.acceptedRate || 0),
          avgLatencyMs: Number(parsed.avgLatencyMs || 0),
        };
      })
      .filter((entry) => entry.total > 0)
      .sort((left, right) => left.modelName.localeCompare(right.modelName));

    return {
      progress: progressSource
        ? {
            completed: Number(progressSource.completed || 0),
            total: Number(progressSource.total || 0),
            percent: Number(progressSource.percent || 0),
            status: String(progressSource.status || ""),
            currentModel: String(progressSource.currentModel || ""),
            currentCase: String(progressSource.currentCase || ""),
            currentRun: Number(progressSource.currentRun || 0),
          }
        : null,
      models,
    };
  }

  const selectedRunSummary = useMemo(
    () => parseRunSummary(selectedRun?.run.summary || selectedRunMeta?.summary || null),
    [selectedRun, selectedRunMeta],
  );

  useEffect(() => {
    let cancelled = false;

    async function syncRuntimeDefaults() {
      try {
        const response = await fetch("/api/runtime");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as {
          health: { ok: boolean; modelName: string };
          settings: { modelName: string; modelBaseUrl: string; suggestStrategy: SuggestStrategy };
        };
        const nextModel = data.health.ok ? data.health.modelName : data.settings.modelName;
        const nextDefaults = {
          model: nextModel,
          suggestStrategy: data.settings.suggestStrategy,
        };
        if (cancelled) {
          return;
        }
        setRuntimeDefaults(nextDefaults);
        setRunForm((current) => ({
          ...current,
          models:
            current.models.length === 1 && current.models[0] === defaultModel
              ? [nextDefaults.model]
              : current.models,
        }));
        setTestForm((current) => ({
          ...current,
          models:
            current.models.length === 1 && current.models[0] === defaultModel
              ? [nextDefaults.model]
              : current.models,
          suggestStrategy:
            current.suggestStrategy === defaultSuggestStrategy
              ? nextDefaults.suggestStrategy
              : current.suggestStrategy,
        }));
      } catch {
        // Keep the server-provided defaults when the runtime refresh is unavailable.
      }
    }

    void syncRuntimeDefaults();
    return () => {
      cancelled = true;
    };
  }, [defaultModel, defaultSuggestStrategy]);

  function addModel(
    target: "run" | "test",
    explicitValue?: string,
  ) {
    const rawValue = (explicitValue ?? (target === "run" ? runModelInput : testModelInput)).trim();
    if (!rawValue) {
      return;
    }

    if (target === "run") {
      setRunForm((current) => ({
        ...current,
        models: current.models.includes(rawValue) ? current.models : [...current.models, rawValue],
      }));
      setRunModelInput("");
      return;
    }

    setTestForm((current) => ({
      ...current,
      models: current.models.includes(rawValue) ? current.models : [...current.models, rawValue],
    }));
    setTestModelInput("");
  }

  function removeModel(target: "run" | "test", modelName: string) {
    if (target === "run") {
      setRunForm((current) => ({
        ...current,
        models: current.models.filter((value) => value !== modelName),
      }));
      return;
    }

    setTestForm((current) => ({
      ...current,
      models: current.models.filter((value) => value !== modelName),
    }));
  }

  const refreshRuns = useCallback(async () => {
    const response = await fetch("/api/benchmarks");
    const data = (await response.json()) as { runs: BenchmarkRunRow[] };
    setRuns(data.runs);
    if (selectedRunId !== null) {
      const nextSelected = data.runs.find((run) => run.id === selectedRunId) || null;
      if (nextSelected && selectedRun) {
        setSelectedRun((current) => (current ? { ...current, run: nextSelected } : current));
      }
      if (
        nextSelected &&
        nextSelected.status === "completed" &&
        (!selectedRun || selectedRun.run.finishedAtMs !== nextSelected.finishedAtMs)
      ) {
        void loadRun(selectedRunId);
      }
    }
  }, [selectedRun, selectedRunId]);

  useEffect(() => {
    if (activeRuns.length === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshRuns();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeRuns.length, refreshRuns]);

  async function loadRun(runId: number) {
    setLoadingRunId(runId);
    setError("");
    try {
      const response = await fetch(`/api/benchmarks/${runId}`);
      const data = (await response.json()) as
        | { error: string }
        | { run: BenchmarkRunRow; results: BenchmarkResultRow[] };
      if (!response.ok || "error" in data) {
        throw new Error("Unable to load benchmark run");
      }
      setSelectedRun(data);
      setSelectedRunId(runId);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to load benchmark run",
      );
    } finally {
      setLoadingRunId(null);
    }
  }

  function resetBenchmarkForm() {
    setRunForm({
      models: [runtimeDefaults.model],
      repeatCount: "2",
      timeoutMs: "5000",
    });
    setRunModelInput("");
  }

  function resetAdHocForm() {
    setTestForm({
      models: [runtimeDefaults.model],
      sessionId: "",
      buffer: "git st",
      cwd: "",
      recentCommands: "",
      lastExitCode: "",
      suggestStrategy: runtimeDefaults.suggestStrategy,
    });
    setTestModelInput("");
    setTestResults([]);
    setError("");
    setMessage("");
  }

  async function onStartBenchmark(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (normalizedRunModels.length === 0) {
      setError("Choose at least one model before queueing a benchmark.");
      return;
    }
    setLoadingRun(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/benchmarks/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          models: normalizedRunModels,
          repeatCount: Number.parseInt(runForm.repeatCount || "1", 10) || 1,
          timeoutMs: Number.parseInt(runForm.timeoutMs || "5000", 10) || 5000,
        }),
      });
      const data = (await response.json()) as { runId?: number; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to start benchmark");
      }
      setMessage(`Benchmark queued as run #${data.runId}.`);
      await refreshRuns();
      if (typeof data.runId === "number") {
        setSelectedRunId(data.runId);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to start benchmark");
    } finally {
      setLoadingRun(false);
    }
  }

  async function onRunAdHoc(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (normalizedTestModels.length === 0) {
      setError("Choose at least one model before running an ad-hoc test.");
      return;
    }
    if (!testForm.buffer.trim()) {
      setError("Buffer is required for ad-hoc tests.");
      return;
    }
    setLoadingTest(true);
    setError("");
    setMessage("");
    try {
      const parsedLastExitCode = testForm.lastExitCode.trim()
        ? Number.parseInt(testForm.lastExitCode, 10)
        : null;
      const responses = await Promise.all(
        normalizedTestModels.map(async (modelName) => {
          const response = await fetch("/api/ranking", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              session_id: testForm.sessionId.trim(),
              buffer: testForm.buffer,
              cwd: testForm.cwd.trim(),
              ...(Number.isFinite(parsedLastExitCode)
                ? { last_exit_code: parsedLastExitCode }
                : {}),
              model_name: modelName,
              strategy: testForm.suggestStrategy,
              recent_commands: testForm.recentCommands
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
              limit: 6,
            }),
          });
          const data = (await response.json()) as RankingResponse & { error?: string };
          if (!response.ok) {
            throw new Error(data.error || `Unable to test ${modelName}`);
          }
          return data;
        }),
      );
      setTestResults(responses);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ad-hoc test failed");
    } finally {
      setLoadingTest(false);
    }
  }

  return (
    <div className="stack-lg">
      <div className="panel subtle-panel">
        <div className="panel-body">
          <ul className="metric-list compact-metrics">
            <li>
              <span>Current runtime model</span>
              <strong>{runtimeDefaults.model}</strong>
            </li>
            <li>
              <span>Saved strategy</span>
              <strong>{runtimeDefaults.suggestStrategy}</strong>
            </li>
          </ul>
        </div>
      </div>

      <div className="grid two-up">
        <div className="detail-block">
          <div className="detail-block-header">
            <div>
              <h3>Run Saved Benchmarks</h3>
              <p className="helper-text">
                Queue repeatable comparisons and pin them to the current runtime model when you want a quick baseline.
              </p>
            </div>
            <button type="button" className="button-secondary" onClick={resetBenchmarkForm}>
              Reset Form
            </button>
          </div>
          <form className="stack-sm" onSubmit={onStartBenchmark}>
            <ModelPicker
              mode="multi"
              label="Models"
              selected={runForm.models}
              inputValue={runModelInput}
              options={availableModels}
              installedOnly
              onInputChange={setRunModelInput}
              onAdd={(value) => addModel("run", value)}
              onRemove={(value) => removeModel("run", value)}
              onClearAll={() =>
                setRunForm((current) => ({
                  ...current,
                  models: [],
                }))
              }
              requireKnownOption
              placeholder="Pick an installed model"
              helperText={`${inventorySummary.installedCount} installed locally · ${inventorySummary.libraryCount} available to download`}
              emptyMessage={
                <>
                  No matching installed models. Download additional models from the{" "}
                  <Link href="/models">Models</Link> page.
                </>
              }
            />
            <p className="helper-text">
              Saved benchmarks compare raw model completions against the benchmark suite. Use the ad-hoc form below to compare suggestion strategies.
            </p>
            <div className="form-grid compact">
              <label>
                Repeat Count
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={runForm.repeatCount}
                  onChange={(event) =>
                    setRunForm((current) => ({ ...current, repeatCount: event.target.value }))
                  }
                />
              </label>
              <label>
                Timeout (ms)
                <input
                  type="number"
                  min={500}
                  step={100}
                  inputMode="numeric"
                  value={runForm.timeoutMs}
                  onChange={(event) =>
                    setRunForm((current) => ({ ...current, timeoutMs: event.target.value }))
                  }
                />
              </label>
            </div>
            <div className="inline-actions">
              <button type="submit" disabled={!canQueueBenchmark}>
                {loadingRun ? "Queueing..." : "Queue Benchmark"}
              </button>
              <button type="button" className="button-secondary" onClick={() => void refreshRuns()}>
                Refresh Runs
              </button>
            </div>
          </form>
        </div>

        <div className="detail-block">
          <div className="detail-block-header">
            <div>
              <h3>Ad-Hoc Model Test</h3>
              <p className="helper-text">
                Buffer is the only required field. Add a session or a working
                directory when you want the engine to infer repo context and
                pull recent command history automatically.
              </p>
            </div>
            <div className="inline-actions">
              <button type="button" className="button-secondary" onClick={resetAdHocForm}>
                Reset Context
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  setTestResults([]);
                  setMessage("");
                  setError("");
                }}
              >
                Clear Results
              </button>
            </div>
          </div>
          <form className="stack-sm" onSubmit={onRunAdHoc}>
            <ModelPicker
              mode="multi"
              label="Models"
              selected={testForm.models}
              inputValue={testModelInput}
              options={availableModels}
              installedOnly
              onInputChange={setTestModelInput}
              onAdd={(value) => addModel("test", value)}
              onRemove={(value) => removeModel("test", value)}
              onClearAll={() =>
                setTestForm((current) => ({
                  ...current,
                  models: [],
                }))
              }
              requireKnownOption
              placeholder="Pick or type a model"
              helperText={
                inventorySummary.installedError || inventorySummary.libraryError
                  ? [inventorySummary.installedError, inventorySummary.libraryError]
                      .filter(Boolean)
                      .join(" · ")
                  : "Pick one or more installed Ollama models. The saved runtime strategy is used by default, but you can override it here for this test."
              }
              emptyMessage={
                <>
                  No matching installed models. Download additional models from the{" "}
                  <Link href="/models">Models</Link> page.
                </>
              }
            />
            <SuggestStrategyField
              value={testForm.suggestStrategy}
              onChange={(value) =>
                setTestForm((current) => ({ ...current, suggestStrategy: value }))
              }
            />
            <label>
              Session ID
              <input
                placeholder="Optional session id"
                value={testForm.sessionId}
                onChange={(event) =>
                  setTestForm((current) => ({ ...current, sessionId: event.target.value }))
                }
              />
            </label>
            <label>
              Buffer
              <input
                placeholder="git st"
                value={testForm.buffer}
                onChange={(event) =>
                  setTestForm((current) => ({ ...current, buffer: event.target.value }))
                }
              />
            </label>
            <div className="form-grid compact">
              <label>
                CWD
                <PathHoverActions pathValue={testForm.cwd} label="Ad-hoc test cwd" variant="input">
                  <input
                    placeholder="/Users/simon/projects/gleamery"
                    value={testForm.cwd}
                    onChange={(event) =>
                      setTestForm((current) => ({ ...current, cwd: event.target.value }))
                    }
                  />
                </PathHoverActions>
              </label>
              <label>
                Last Exit Code
                <input
                  type="number"
                  inputMode="numeric"
                  value={testForm.lastExitCode}
                  onChange={(event) =>
                    setTestForm((current) => ({ ...current, lastExitCode: event.target.value }))
                  }
                />
              </label>
            </div>
            <label>
              Recent Commands
              <textarea
                rows={4}
                placeholder={"git fetch\npnpm test"}
                value={testForm.recentCommands}
                onChange={(event) =>
                  setTestForm((current) => ({ ...current, recentCommands: event.target.value }))
                }
              />
            </label>
            <button type="submit" disabled={!canRunAdHoc}>
              {loadingTest ? "Testing..." : "Run Ad-Hoc Test"}
            </button>
          </form>
        </div>
      </div>

      {message ? <p className="success-text">{message}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {testResults.length > 0 ? (
        <div className="detail-block">
          <div className="detail-block-header">
            <div>
              <h3>Ad-Hoc Results</h3>
              <p className="helper-text">
                Compared {testResults.length} model{testResults.length === 1 ? "" : "s"} for the current prompt context.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Best Suggestion</th>
                  <th>Source</th>
                  <th>Top Score</th>
                  <th>Candidates</th>
                  <th>Raw Output</th>
                </tr>
              </thead>
              <tbody>
                {testResults.map((result) => (
                  <tr key={`${result.model_name}-summary`}>
                    <td>{result.model_name}</td>
                    <td>
                      <code>{result.winner?.command || result.cleaned_model_output || "No suggestion"}</code>
                    </td>
                    <td>{result.winner?.source || "n/a"}</td>
                    <td>{result.candidates[0]?.score ?? "n/a"}</td>
                    <td>{result.candidates.length}</td>
                    <td>{result.raw_model_output ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="stack-md">
            {testResults.map((result) => (
              <div key={result.model_name} className="result-card">
                <div className="result-card-header">
                  <strong>{result.model_name}</strong>
                  <span>{result.winner?.command || "No winner"}</span>
                </div>
                <p className="muted-text">
                  Cleaned output: <code>{result.cleaned_model_output || "n/a"}</code>
                </p>
                <pre className="code-block">{result.raw_model_output || "No raw model output."}</pre>
                {result.candidates.length > 0 ? (
                  <ul className="pill-list">
                    {result.candidates.map((candidate) => (
                      <li key={`${result.model_name}-${candidate.command}`}>
                        <code>{candidate.command}</code> <span>{candidate.source}</span> <strong>{candidate.score}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="helper-text">No ranked candidates were returned for this model.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="detail-block">
        <div className="detail-block-header">
          <div>
            <h3>Saved Benchmark Runs</h3>
            <p className="helper-text">
              Review queued and completed runs, then drill into the saved result rows below.
            </p>
          </div>
        </div>
        {activeRuns.length > 0 ? (
          <div className="run-status-strip">
            <strong>
              {activeRuns.length} benchmark run{activeRuns.length === 1 ? "" : "s"} active
            </strong>
            <span>Auto-refreshing while queued or running.</span>
          </div>
        ) : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Models</th>
                <th>Repeat</th>
                <th>Timeout</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className={selectedRunId === run.id ? "table-row-active" : undefined}
                >
                  <td>#{run.id}</td>
                  <td>
                    <span className={`status-pill status-pill-${run.status}`}>{run.status}</span>
                  </td>
                  <td>
                    {(() => {
                      const summary = parseRunSummary(run.summary);
                      const progress = summary.progress;
                      if (!progress) {
                        return <span className="muted-text">{run.status === "completed" ? "Done" : "Waiting"}</span>;
                      }
                      return (
                        <div className="run-progress-cell">
                          <div className="progress-bar">
                            <div
                              className="progress-bar-fill"
                              style={{ width: `${Math.max(6, progress.percent)}%` }}
                            />
                          </div>
                          <span>
                            {progress.total > 0
                              ? `${progress.completed}/${progress.total}`
                              : progress.status || run.status}
                          </span>
                        </div>
                      );
                    })()}
                  </td>
                  <td>{run.models.join(", ")}</td>
                  <td>{run.repeatCount}</td>
                  <td>{formatDurationMs(run.timeoutMs)}</td>
                  <td>{formatTimestamp(run.createdAtMs)}</td>
                  <td>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void loadRun(run.id)}
                    >
                      {loadingRunId === run.id ? "Loading..." : "View"}
                    </button>
                  </td>
                </tr>
              ))}
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={8}>No benchmark runs saved yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRun ? (
        <div className="detail-block">
          <div className="detail-block-header">
            <div>
              <h3>Benchmark Run #{selectedRun.run.id}</h3>
              <p className="muted-text">
                Status: {selectedRunMeta?.status || selectedRun.run.status} · Models: {selectedRun.run.models.join(", ")}
              </p>
            </div>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setSelectedRun(null);
                setSelectedRunId(null);
              }}
            >
              Close Run
            </button>
          </div>
          {selectedRunSummary.progress ? (
            <div className="run-progress-panel">
              <div className="run-progress-copy">
                <strong>
                  {selectedRunSummary.progress.total > 0
                    ? `${selectedRunSummary.progress.completed}/${selectedRunSummary.progress.total} benchmark checks complete`
                    : selectedRunSummary.progress.status || "Running"}
                </strong>
                <span>
                  {selectedRunSummary.progress.currentModel
                    ? `${selectedRunSummary.progress.currentModel} · ${selectedRunSummary.progress.currentCase || "warming up"}`
                    : "Waiting for the next benchmark update."}
                </span>
              </div>
              <div className="progress-bar progress-bar-large">
                <div
                  className="progress-bar-fill"
                  style={{
                    width: `${Math.max(6, selectedRunSummary.progress.percent)}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          {selectedRunSummary.models.length > 0 ? (
            <div className="benchmark-compare-grid">
              {selectedRunSummary.models.map((summary) => (
                <div key={summary.modelName} className="benchmark-compare-card">
                  <div className="benchmark-compare-header">
                    <strong>{summary.modelName}</strong>
                    <span>{summary.total} cases</span>
                  </div>
                  <dl className="benchmark-compare-stats">
                    <div>
                      <dt>Avg. latency</dt>
                      <dd>{formatDurationMs(summary.avgLatencyMs)}</dd>
                    </div>
                    <div>
                      <dt>Valid prefix</dt>
                      <dd>{Math.round(summary.validPrefixRate * 100)}%</dd>
                    </div>
                    <div>
                      <dt>Accepted</dt>
                      <dd>{Math.round(summary.acceptedRate * 100)}%</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          ) : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Case</th>
                  <th>Run</th>
                  <th>Latency</th>
                  <th>Valid Prefix</th>
                  <th>Accepted</th>
                  <th>Suggestion</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {selectedRun.results.map((result) => (
                  <tr key={result.id}>
                    <td>{result.modelName}</td>
                    <td>{result.caseName}</td>
                    <td>{result.runNumber}</td>
                    <td>{formatDurationMs(result.latencyMs)}</td>
                    <td>{result.validPrefix ? "yes" : "no"}</td>
                    <td>{result.accepted ? "yes" : "no"}</td>
                    <td>
                      <code>{result.suggestionText}</code>
                    </td>
                    <td>{result.errorText || "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
