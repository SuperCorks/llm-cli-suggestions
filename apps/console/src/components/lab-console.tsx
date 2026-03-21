"use client";

import { useMemo, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { formatDurationMs, formatTimestamp } from "@/lib/format";
import type { BenchmarkResultRow, BenchmarkRunRow, OllamaModelOption } from "@/lib/types";

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
  defaultModelBaseUrl: string;
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
  defaultModelBaseUrl,
  availableModels,
  inventorySummary,
}: LabConsoleProps) {
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
    buffer: "git st",
    cwd: "",
    repoRoot: "",
    branch: "",
    recentCommands: "",
    lastExitCode: "0",
    modelBaseUrl: defaultModelBaseUrl,
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

  async function refreshRuns() {
    const response = await fetch("/api/benchmarks");
    const data = (await response.json()) as { runs: BenchmarkRunRow[] };
    setRuns(data.runs);
  }

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
      models: [defaultModel],
      repeatCount: "2",
      timeoutMs: "5000",
    });
    setRunModelInput("");
  }

  function resetAdHocForm() {
    setTestForm({
      models: [defaultModel],
      buffer: "git st",
      cwd: "",
      repoRoot: "",
      branch: "",
      recentCommands: "",
      lastExitCode: "0",
      modelBaseUrl: defaultModelBaseUrl,
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
      const responses = await Promise.all(
        normalizedTestModels.map(async (modelName) => {
          const response = await fetch("/api/ranking", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              session_id: "console-lab",
              buffer: testForm.buffer,
              cwd: testForm.cwd,
              repo_root: testForm.repoRoot,
              branch: testForm.branch,
              last_exit_code: Number.parseInt(testForm.lastExitCode || "0", 10) || 0,
              model_name: modelName,
              model_base_url: testForm.modelBaseUrl,
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
              <strong>{defaultModel}</strong>
            </li>
            <li>
              <span>Installed locally</span>
              <strong>{inventorySummary.installedCount}</strong>
            </li>
            <li>
              <span>Available to Download</span>
              <strong>{inventorySummary.libraryCount}</strong>
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
              onInputChange={setRunModelInput}
              onAdd={(value) => addModel("run", value)}
              onRemove={(value) => removeModel("run", value)}
              onClearAll={() =>
                setRunForm((current) => ({
                  ...current,
                  models: [],
                }))
              }
              placeholder="Pick or type a model"
              helperText={`${inventorySummary.installedCount} installed · ${inventorySummary.libraryCount} available from Ollama`}
            />
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
                Only the buffer is required. Add context fields when you want to simulate a real shell situation more closely.
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
              onInputChange={setTestModelInput}
              onAdd={(value) => addModel("test", value)}
              onRemove={(value) => removeModel("test", value)}
              onClearAll={() =>
                setTestForm((current) => ({
                  ...current,
                  models: [],
                }))
              }
              placeholder="Pick or type a model"
              helperText={
                inventorySummary.installedError || inventorySummary.libraryError
                  ? [inventorySummary.installedError, inventorySummary.libraryError]
                      .filter(Boolean)
                      .join(" · ")
                  : "Use installed models or type any Ollama library model manually."
              }
            />
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
                <input
                  placeholder="/Users/simon/projects/gleamery"
                  value={testForm.cwd}
                  onChange={(event) =>
                    setTestForm((current) => ({ ...current, cwd: event.target.value }))
                  }
                />
              </label>
              <label>
                Repo Root
                <input
                  placeholder="/Users/simon/projects/gleamery"
                  value={testForm.repoRoot}
                  onChange={(event) =>
                    setTestForm((current) => ({ ...current, repoRoot: event.target.value }))
                  }
                />
              </label>
              <label>
                Branch
                <input
                  placeholder="main"
                  value={testForm.branch}
                  onChange={(event) =>
                    setTestForm((current) => ({ ...current, branch: event.target.value }))
                  }
                />
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
            <label>
              Model Base URL
              <input
                placeholder="http://127.0.0.1:11434"
                value={testForm.modelBaseUrl}
                onChange={(event) =>
                  setTestForm((current) => ({ ...current, modelBaseUrl: event.target.value }))
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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Status</th>
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
                  <td>{run.status}</td>
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
                  <td colSpan={7}>No benchmark runs saved yet.</td>
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
                Status: {selectedRun.run.status} · Models: {selectedRun.run.models.join(", ")}
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
