"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { PathHoverActions } from "@/components/path-hover-actions";
import { SuggestStrategyField } from "@/components/suggest-strategy-field";
import { formatDurationMs, formatTimestamp } from "@/lib/format";
import type {
  BenchmarkAggregateSummary,
  BenchmarkRunSummary,
  BenchmarkResultRow,
  BenchmarkRunRow,
  BenchmarkTrack,
  OllamaModelOption,
  SuggestStrategy,
} from "@/lib/types";

const BENCHMARK_STALL_THRESHOLD_MS = 45_000;

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

type InventorySummary = LabConsoleProps["inventorySummary"];

function emptyAggregateSummary(): BenchmarkAggregateSummary {
  return {
    count: 0,
    quality: {
      positiveCaseCount: 0,
      negativeCaseCount: 0,
      positiveExactHitRate: 0,
      negativeAvoidRate: 0,
      validWinnerRate: 0,
      candidateRecallAt3: 0,
      charsSavedRatio: 0,
    },
    latency: {
      count: 0,
      mean: 0,
      median: 0,
      p90: 0,
      p95: 0,
      max: 0,
    },
    startStates: [],
    coldPenaltyMs: 0,
    stages: [],
    budgetPassRates: [],
    categoryBreakdown: [],
    sourceBreakdown: [],
  };
}

function formatRecencyLabel(value?: number) {
  if (!value) {
    return "n/a";
  }
  const elapsedMs = Date.now() - value;
  if (elapsedMs < 1000) {
    return "just now";
  }
  if (elapsedMs < 60_000) {
    return `${Math.max(1, Math.round(elapsedMs / 1000))}s ago`;
  }
  if (elapsedMs < 3_600_000) {
    return `${Math.max(1, Math.round(elapsedMs / 60_000))}m ago`;
  }
  return formatTimestamp(value);
}

function parseReplaySampleLimit(filtersJson: string) {
  try {
    return Number(
      (JSON.parse(filtersJson || "{}") as { sample_limit?: number }).sample_limit || 200,
    );
  } catch {
    return 200;
  }
}

function formatRunInfoTimestamp(value: number) {
  return value > 0 ? formatTimestamp(value) : "n/a";
}

function buildRunInfoItems(run: BenchmarkRunRow) {
  const items = [
    { label: "Status", value: run.status },
    { label: "Track", value: run.track },
    { label: "Surface", value: run.surface },
    { label: "Strategy", value: run.strategy },
    { label: "Suite", value: run.suiteName },
    { label: "Protocol", value: run.timingProtocol },
    { label: "Repeat", value: String(run.repeatCount) },
    { label: "Timeout", value: formatDurationMs(run.timeoutMs) },
    { label: "Models", value: run.models.join(", ") || "n/a" },
    { label: "Dataset", value: run.datasetSize > 0 ? `${run.datasetSize} cases` : "n/a" },
    { label: "Created", value: formatRunInfoTimestamp(run.createdAtMs) },
    { label: "Started", value: formatRunInfoTimestamp(run.startedAtMs) },
    { label: "Finished", value: formatRunInfoTimestamp(run.finishedAtMs) },
  ];

  if (run.track === "replay") {
    items.push({
      label: "Replay Sample",
      value: `${parseReplaySampleLimit(run.filtersJson)} rows`,
    });
  }

  return items;
}

function normalizeAggregateSummary(
  aggregate?: Partial<BenchmarkAggregateSummary> | null,
): BenchmarkAggregateSummary {
  return {
    count: aggregate?.count || 0,
    quality: {
      positiveCaseCount: aggregate?.quality?.positiveCaseCount || 0,
      negativeCaseCount: aggregate?.quality?.negativeCaseCount || 0,
      positiveExactHitRate: aggregate?.quality?.positiveExactHitRate || 0,
      negativeAvoidRate: aggregate?.quality?.negativeAvoidRate || 0,
      validWinnerRate: aggregate?.quality?.validWinnerRate || 0,
      candidateRecallAt3: aggregate?.quality?.candidateRecallAt3 || 0,
      charsSavedRatio: aggregate?.quality?.charsSavedRatio || 0,
    },
    latency: {
      count: aggregate?.latency?.count || 0,
      mean: aggregate?.latency?.mean || 0,
      median: aggregate?.latency?.median || 0,
      p90: aggregate?.latency?.p90 || 0,
      p95: aggregate?.latency?.p95 || 0,
      max: aggregate?.latency?.max || 0,
    },
    startStates: Array.isArray(aggregate?.startStates) ? aggregate.startStates : [],
    coldPenaltyMs: aggregate?.coldPenaltyMs || 0,
    stages: Array.isArray(aggregate?.stages) ? aggregate.stages : [],
    budgetPassRates: Array.isArray(aggregate?.budgetPassRates) ? aggregate.budgetPassRates : [],
    categoryBreakdown: Array.isArray(aggregate?.categoryBreakdown)
      ? aggregate.categoryBreakdown
      : [],
    sourceBreakdown: Array.isArray(aggregate?.sourceBreakdown) ? aggregate.sourceBreakdown : [],
  };
}

export function LabConsole({
  initialRuns,
  defaultModel,
  defaultSuggestStrategy,
  availableModels,
  inventorySummary,
}: LabConsoleProps) {
  const [modelOptions, setModelOptions] = useState(availableModels);
  const [modelInventory, setModelInventory] = useState<InventorySummary>(inventorySummary);
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
    track: "static" as BenchmarkTrack,
    suiteName: "core",
    timingProtocol: "full" as BenchmarkRunRow["timingProtocol"],
    strategy: defaultSuggestStrategy,
    replaySampleLimit: "200",
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
  const [replayingRunId, setReplayingRunId] = useState<number | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<number | null>(null);
  const [pinnedRunInfoId, setPinnedRunInfoId] = useState<number | null>(null);
  const [loadingTest, setLoadingTest] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resultFilters, setResultFilters] = useState({
    model: "all",
    category: "all",
    labelKind: "all",
    startState: "all",
    query: "",
  });
  const workerLogRef = useRef<HTMLPreElement | null>(null);
  const shouldFollowWorkerLogRef = useRef(true);
  const selectedRunRef = useRef<{
    run: BenchmarkRunRow;
    results: BenchmarkResultRow[];
  } | null>(null);
  const selectedRunIdRef = useRef<number | null>(null);
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

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (!target.closest("[data-run-info-root]")) {
        setPinnedRunInfoId(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPinnedRunInfoId(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function parseRunSummary(summary: BenchmarkRunSummary | null) {
    const fallback = {
      progress: {
        completed: 0,
        total: 0,
        percent: 0,
        status: "",
        currentModel: "",
        currentCase: "",
        currentRun: 0,
        currentPhase: "",
      },
      track: "static" as BenchmarkTrack,
      surface: "end_to_end" as const,
      suiteName: "",
      strategy: "",
      timingProtocol: "full" as const,
      datasetSize: 0,
      positiveCaseCount: 0,
      negativeCaseCount: 0,
      overall: emptyAggregateSummary(),
      models: [],
    };

    if (!summary) {
      return fallback;
    }

    return {
      progress: {
        completed: summary.progress?.completed || 0,
        total: summary.progress?.total || 0,
        percent: summary.progress?.percent || 0,
        status: summary.progress?.status || "",
        currentModel: summary.progress?.currentModel || "",
        currentCase: summary.progress?.currentCase || "",
        currentRun: summary.progress?.currentRun || 0,
        currentPhase: summary.progress?.currentPhase || "",
      },
      track: summary.track || fallback.track,
      surface: summary.surface || fallback.surface,
      suiteName: summary.suiteName || "",
      strategy: summary.strategy || "",
      timingProtocol: summary.timingProtocol || fallback.timingProtocol,
      datasetSize: summary.datasetSize || 0,
      positiveCaseCount: summary.positiveCaseCount || 0,
      negativeCaseCount: summary.negativeCaseCount || 0,
      overall: normalizeAggregateSummary(summary.overall),
      models: Array.isArray(summary.models)
        ? summary.models.map((modelSummary) => ({
            model: modelSummary.model || "",
            overall: normalizeAggregateSummary(modelSummary.overall),
            cold: normalizeAggregateSummary(modelSummary.cold),
            hot: normalizeAggregateSummary(modelSummary.hot),
          }))
        : [],
    };
  }

  const selectedRunSummary = useMemo(
    () => parseRunSummary(selectedRun?.run.summary || selectedRunMeta?.summary || null),
    [selectedRun, selectedRunMeta],
  );
  const selectedRunResults = useMemo(() => selectedRun?.results || [], [selectedRun]);
  const filteredRunResults = useMemo(
    () =>
      selectedRunResults.filter((row) => {
        if (resultFilters.model !== "all" && row.modelName !== resultFilters.model) {
          return false;
        }
        if (resultFilters.category !== "all" && row.category !== resultFilters.category) {
          return false;
        }
        if (resultFilters.labelKind !== "all" && row.labelKind !== resultFilters.labelKind) {
          return false;
        }
        if (resultFilters.startState !== "all" && row.startState !== resultFilters.startState) {
          return false;
        }
        if (!resultFilters.query.trim()) {
          return true;
        }
        const query = resultFilters.query.trim().toLowerCase();
        return (
          row.caseName.toLowerCase().includes(query) ||
          row.winnerCommand.toLowerCase().includes(query) ||
          row.expectedCommand.toLowerCase().includes(query) ||
          row.negativeTarget.toLowerCase().includes(query)
        );
      }),
    [resultFilters, selectedRunResults],
  );
  const selectedRunLastEventAtMs =
    selectedRunMeta?.lastEventAtMs || selectedRun?.run.lastEventAtMs || 0;
  const selectedRunLogText = (selectedRunMeta?.logText || selectedRun?.run.logText || "").trim();
  const selectedRunIsActive =
    (selectedRunMeta?.status || selectedRun?.run.status) === "running" ||
    (selectedRunMeta?.status || selectedRun?.run.status) === "queued";
  const selectedRunIsStalled =
    selectedRunIsActive &&
    selectedRunLastEventAtMs > 0 &&
    Date.now() - selectedRunLastEventAtMs > BENCHMARK_STALL_THRESHOLD_MS;

  useEffect(() => {
    setModelOptions(availableModels);
  }, [availableModels]);

  useEffect(() => {
    setModelInventory(inventorySummary);
  }, [inventorySummary]);

  useEffect(() => {
    selectedRunRef.current = selectedRun;
  }, [selectedRun]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    setRuns(initialRuns);
  }, [initialRuns]);

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
        try {
          const inventoryResponse = await fetch(
            `/api/ollama/models?baseUrl=${encodeURIComponent(data.settings.modelBaseUrl)}`,
          );
          if (inventoryResponse.ok) {
            const inventoryData = (await inventoryResponse.json()) as {
              models?: OllamaModelOption[];
              installedCount?: number;
              libraryCount?: number;
              installedError?: string;
              libraryError?: string;
            };
            if (!cancelled) {
              if (Array.isArray(inventoryData.models) && inventoryData.models.length > 0) {
                setModelOptions(inventoryData.models);
              }
              setModelInventory((current) => ({
                installedCount: inventoryData.installedCount ?? current.installedCount,
                libraryCount: inventoryData.libraryCount ?? current.libraryCount,
                installedError: inventoryData.installedError,
                libraryError: inventoryData.libraryError,
              }));
            }
          }
        } catch {
          // Keep the server-provided inventory when the browser refresh is unavailable.
        }
        setRunForm((current) => ({
          ...current,
          models:
            current.models.length === 1 && current.models[0] === defaultModel
              ? [nextDefaults.model]
              : current.models,
          strategy:
            current.strategy === defaultSuggestStrategy
              ? nextDefaults.suggestStrategy
              : current.strategy,
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

  useEffect(() => {
    shouldFollowWorkerLogRef.current = true;
  }, [selectedRunId]);

  useEffect(() => {
    const container = workerLogRef.current;
    if (!container || !shouldFollowWorkerLogRef.current) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [selectedRunLogText]);

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

  const refreshRuns = useCallback(async (selectedRunIdOverride?: number | null) => {
    const response = await fetch("/api/benchmarks", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Unable to refresh benchmark runs");
    }
    const data = (await response.json()) as { runs: BenchmarkRunRow[] };
    setRuns(data.runs);
    const currentSelectedRunId = selectedRunIdOverride ?? selectedRunIdRef.current;
    const currentSelectedRun = selectedRunRef.current;
    if (currentSelectedRunId !== null) {
      const nextSelected = data.runs.find((run) => run.id === currentSelectedRunId) || null;
      if (!nextSelected) {
        setSelectedRun(null);
        setSelectedRunId(null);
        return;
      }
      if (currentSelectedRun) {
        setSelectedRun((current) => (current ? { ...current, run: nextSelected } : current));
      }
      if (
        nextSelected &&
        (nextSelected.status === "completed" || nextSelected.status === "failed") &&
        (!currentSelectedRun || currentSelectedRun.run.finishedAtMs !== nextSelected.finishedAtMs)
      ) {
        void loadRun(currentSelectedRunId);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncRunsOnMount() {
      try {
        await refreshRuns();
      } catch (requestError) {
        if (!cancelled && initialRuns.length === 0) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to refresh benchmark runs",
          );
        }
      }
    }

    void syncRunsOnMount();
    return () => {
      cancelled = true;
    };
  }, [initialRuns.length, refreshRuns]);

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
      const response = await fetch(`/api/benchmarks/${runId}`, { cache: "no-store" });
      const data = (await response.json()) as
        | { error: string }
        | { run: BenchmarkRunRow; results: BenchmarkResultRow[] };
      if (!response.ok || "error" in data) {
        throw new Error("Unable to load benchmark run");
      }
      setSelectedRun(data);
      setSelectedRunId(runId);
      setResultFilters({
        model: "all",
        category: "all",
        labelKind: "all",
        startState: "all",
        query: "",
      });
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
      track: "static",
      suiteName: "core",
      timingProtocol: "full",
      strategy: runtimeDefaults.suggestStrategy,
      replaySampleLimit: "200",
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
          track: runForm.track,
          suiteName: runForm.suiteName,
          strategy: runForm.strategy,
          timingProtocol: runForm.timingProtocol,
          models: normalizedRunModels,
          repeatCount: Number.parseInt(runForm.repeatCount || "1", 10) || 1,
          timeoutMs: Number.parseInt(runForm.timeoutMs || "5000", 10) || 5000,
          replaySampleLimit: Number.parseInt(runForm.replaySampleLimit || "200", 10) || 200,
        }),
      });
      const data = (await response.json()) as { runId?: number; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to start benchmark");
      }
      setMessage(`Benchmark queued as run #${data.runId}.`);
      if (typeof data.runId === "number") {
        setSelectedRunId(data.runId);
        await refreshRuns(data.runId);
      } else {
        await refreshRuns();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to start benchmark");
    } finally {
      setLoadingRun(false);
    }
  }

  async function replayBenchmark(run: BenchmarkRunRow) {
    setReplayingRunId(run.id);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/benchmarks/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          track: run.track,
          suiteName: run.suiteName,
          strategy: run.strategy,
          timingProtocol: run.timingProtocol,
          models: run.models,
          repeatCount: run.repeatCount,
          timeoutMs: run.timeoutMs,
          replaySampleLimit: parseReplaySampleLimit(run.filtersJson),
        }),
      });
      const data = (await response.json()) as { runId?: number; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to replay benchmark");
      }
      setMessage(`Benchmark replay queued as run #${data.runId}.`);
      if (typeof data.runId === "number") {
        setSelectedRunId(data.runId);
        await refreshRuns(data.runId);
      } else {
        await refreshRuns();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to replay benchmark");
    } finally {
      setReplayingRunId(null);
    }
  }

  async function deleteRun(run: BenchmarkRunRow) {
    if (run.status === "queued" || run.status === "running") {
      setError("Queued or running benchmark runs cannot be deleted.");
      return;
    }

    if (
      !window.confirm(
        `Delete benchmark run #${run.id}? This removes its saved results and JSON artifact.`,
      )
    ) {
      return;
    }

    setDeletingRunId(run.id);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/benchmarks/${run.id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string; deletedRunId?: number };
      if (!response.ok) {
        throw new Error(data.error || "Unable to delete benchmark run");
      }

      setRuns((current) => current.filter((item) => item.id !== run.id));
      if (selectedRunIdRef.current === run.id) {
        setSelectedRun(null);
        setSelectedRunId(null);
      }
      setMessage(`Deleted benchmark run #${run.id}.`);
      await refreshRuns();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to delete benchmark run",
      );
    } finally {
      setDeletingRunId(null);
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
              options={modelOptions}
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
              helperText={`${modelInventory.installedCount} installed locally · ${modelInventory.libraryCount} available to download`}
              emptyMessage={
                <>
                  No matching installed models. Download additional models from the{" "}
                  <Link href="/models">Models</Link> page.
                </>
              }
            />
            <p className="helper-text">
              Saved benchmarks can run the curated static suite, a replay sample from your live SQLite history, or raw prompt/model checks with richer timing breakdowns.
            </p>
            <div className="form-grid compact">
              <label>
                Track
                <select
                  value={runForm.track}
                  onChange={(event) =>
                    setRunForm((current) => ({
                      ...current,
                      track: event.target.value as BenchmarkTrack,
                      suiteName:
                        event.target.value === "replay"
                          ? "live-db"
                          : current.track === "replay"
                            ? "core"
                            : current.suiteName,
                    }))
                  }
                >
                  <option value="static">Static suite</option>
                  <option value="replay">Replay from live DB</option>
                  <option value="raw">Raw model</option>
                </select>
              </label>
              <label>
                Suite
                <select
                  value={runForm.suiteName}
                  onChange={(event) =>
                    setRunForm((current) => ({ ...current, suiteName: event.target.value }))
                  }
                  disabled={runForm.track === "replay"}
                >
                  <option value={runForm.track === "replay" ? "live-db" : "core"}>
                    {runForm.track === "replay" ? "live-db" : "core"}
                  </option>
                  {runForm.track !== "replay" ? <option value="extended">extended</option> : null}
                  {runForm.track !== "replay" ? <option value="all">all</option> : null}
                </select>
              </label>
              <label>
                Timing
                <select
                  value={runForm.timingProtocol}
                  onChange={(event) =>
                    setRunForm((current) => ({
                      ...current,
                      timingProtocol: event.target.value as BenchmarkRunRow["timingProtocol"],
                    }))
                  }
                >
                  <option value="full">full</option>
                  <option value="cold_only">cold only</option>
                  <option value="hot_only">hot only</option>
                  <option value="mixed">mixed</option>
                </select>
              </label>
              <label>
                Strategy
                <select
                  value={runForm.strategy}
                  onChange={(event) =>
                    setRunForm((current) => ({
                      ...current,
                      strategy: event.target.value as SuggestStrategy,
                    }))
                  }
                  disabled={runForm.track === "raw"}
                >
                  <option value="history+model">History + model</option>
                  <option value="history-only">History only</option>
                  <option value="model-only">Model only</option>
                </select>
              </label>
              <label>
                Replay Sample
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={runForm.replaySampleLimit}
                  disabled={runForm.track !== "replay"}
                  onChange={(event) =>
                    setRunForm((current) => ({
                      ...current,
                      replaySampleLimit: event.target.value,
                    }))
                  }
                />
              </label>
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
              options={modelOptions}
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
                modelInventory.installedError || modelInventory.libraryError
                  ? [modelInventory.installedError, modelInventory.libraryError]
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
              Review queued and completed runs across static, replay, and raw tracks, then drill into the richer timing and quality breakdowns below.
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
                <th>Track</th>
                <th>Progress</th>
                <th>Models</th>
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
                    <span>{run.track}</span>
                  </td>
                  <td>
                    {(() => {
                      const summary = parseRunSummary(run.summary);
                      const progress = summary.progress;
                      if (!progress.total && run.status !== "running" && run.status !== "queued") {
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
                  <td>
                    <div className="inline-actions">
                      <div
                        className={
                          pinnedRunInfoId === run.id
                            ? "run-info-popover-root run-info-popover-root-open"
                            : "run-info-popover-root"
                        }
                        data-run-info-root
                      >
                        <button
                          type="button"
                          className="icon-button run-info-button"
                          aria-label={`Show details for run #${run.id}`}
                          aria-expanded={pinnedRunInfoId === run.id}
                          aria-controls={`run-info-${run.id}`}
                          onClick={() =>
                            setPinnedRunInfoId((current) =>
                              current === run.id ? null : run.id,
                            )
                          }
                        >
                          <Info aria-hidden="true" />
                        </button>
                        <div
                          id={`run-info-${run.id}`}
                          className="run-info-popover"
                          role="tooltip"
                        >
                          <strong className="run-info-popover-title">
                            Run #{run.id} details
                          </strong>
                          <dl className="run-info-popover-grid">
                            {buildRunInfoItems(run).map((item) => (
                              <div key={`${run.id}-${item.label}`}>
                                <dt>{item.label}</dt>
                                <dd>{item.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void replayBenchmark(run)}
                        disabled={replayingRunId !== null}
                      >
                        {replayingRunId === run.id ? "Replaying..." : "Replay"}
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void loadRun(run.id)}
                      >
                        {loadingRunId === run.id ? "Loading..." : "View"}
                      </button>
                      <button
                        type="button"
                        className="button-danger"
                        onClick={() => void deleteRun(run)}
                        disabled={
                          deletingRunId !== null ||
                          run.status === "queued" ||
                          run.status === "running"
                        }
                        title={
                          run.status === "queued" || run.status === "running"
                            ? "Wait for the benchmark to finish before deleting it."
                            : undefined
                        }
                      >
                        {deletingRunId === run.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6}>No benchmark runs saved yet.</td>
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
                Status: {selectedRunMeta?.status || selectedRun.run.status} · Track: {selectedRun.run.track} · Suite: {selectedRun.run.suiteName} · Protocol: {selectedRun.run.timingProtocol}
              </p>
              <p className="helper-text">
                Last worker update: {formatRecencyLabel(selectedRunLastEventAtMs)}
              </p>
              {selectedRunIsStalled ? (
                <p className="error-text">
                  This run may be stalled. No benchmark worker updates have arrived for more than {Math.round(BENCHMARK_STALL_THRESHOLD_MS / 1000)}s.
                </p>
              ) : null}
              {selectedRunMeta?.errorText || selectedRun.run.errorText ? (
                <p className="error-text">{selectedRunMeta?.errorText || selectedRun.run.errorText}</p>
              ) : null}
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
          <div className="run-progress-panel">
            <div className="run-progress-copy">
              <strong>
                {selectedRunSummary.progress.total > 0
                  ? `${selectedRunSummary.progress.completed}/${selectedRunSummary.progress.total} benchmark checks complete`
                  : selectedRunSummary.progress.status || "Running"}
              </strong>
              <span>
                {selectedRunSummary.progress.currentModel
                  ? `${selectedRunSummary.progress.currentModel} · ${selectedRunSummary.progress.currentCase || "warming up"} · ${selectedRunSummary.progress.currentPhase || "mixed"}`
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
          <div className="panel subtle-panel">
            <div className="panel-body">
              <ul className="metric-list compact-metrics">
                <li>
                  <span>Dataset</span>
                  <strong>{selectedRunSummary.datasetSize}</strong>
                </li>
                <li>
                  <span>Positive exact</span>
                  <strong>{Math.round(selectedRunSummary.overall.quality.positiveExactHitRate * 100)}%</strong>
                </li>
                <li>
                  <span>Negative avoid</span>
                  <strong>{Math.round(selectedRunSummary.overall.quality.negativeAvoidRate * 100)}%</strong>
                </li>
                <li>
                  <span>Valid winner</span>
                  <strong>{Math.round(selectedRunSummary.overall.quality.validWinnerRate * 100)}%</strong>
                </li>
                <li>
                  <span>Mean latency</span>
                  <strong>{formatDurationMs(selectedRunSummary.overall.latency.mean)}</strong>
                </li>
                <li>
                  <span>P95 latency</span>
                  <strong>{formatDurationMs(selectedRunSummary.overall.latency.p95)}</strong>
                </li>
              </ul>
            </div>
          </div>
          {selectedRunSummary.models.length > 0 ? (
            <div className="benchmark-compare-grid">
              {selectedRunSummary.models.map((summary) => (
                <div key={summary.model} className="benchmark-compare-card">
                  <div className="benchmark-compare-header">
                    <strong>{summary.model}</strong>
                    <span>{summary.overall.count} attempts</span>
                  </div>
                  <dl className="benchmark-compare-stats">
                    <div>
                      <dt>Exact</dt>
                      <dd>{Math.round(summary.overall.quality.positiveExactHitRate * 100)}%</dd>
                    </div>
                    <div>
                      <dt>Mean</dt>
                      <dd>{formatDurationMs(summary.overall.latency.mean)}</dd>
                    </div>
                    <div>
                      <dt>Cold</dt>
                      <dd>{formatDurationMs(summary.cold.latency.mean)}</dd>
                    </div>
                    <div>
                      <dt>Hot</dt>
                      <dd>{formatDurationMs(summary.hot.latency.mean)}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid two-up">
            <div className="detail-block">
              <div className="detail-block-header">
                <div>
                  <h3>Latency By Start State</h3>
                  <p className="helper-text">Cold/hot split using Ollama load timing when the model ran.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>State</th>
                      <th>Count</th>
                      <th>Share</th>
                      <th>Mean</th>
                      <th>P95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRunSummary.overall.startStates.map((state) => (
                      <tr key={state.key}>
                        <td>{state.key}</td>
                        <td>{state.count}</td>
                        <td>{Math.round(state.share * 100)}%</td>
                        <td>{formatDurationMs(state.latency.mean)}</td>
                        <td>{formatDurationMs(state.latency.p95)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="detail-block">
              <div className="detail-block-header">
                <div>
                  <h3>Stage Breakdown</h3>
                  <p className="helper-text">Average request, load, prompt, decode, and non-model overhead by start state.</p>
                </div>
              </div>
              <div className="stack-sm">
                {selectedRunSummary.overall.stages.map((stage) => {
                  const total = Math.max(
                    stage.avgRequestLatencyMs,
                    stage.avgLoadDurationMs +
                      stage.avgPromptEvalDurationMs +
                      stage.avgEvalDurationMs +
                      stage.avgNonModelOverheadMs,
                  );
                  return (
                    <div key={stage.label} className="result-card">
                      <div className="result-card-header">
                        <strong>{stage.label}</strong>
                        <span>{formatDurationMs(stage.avgRequestLatencyMs)}</span>
                      </div>
                      <div className="benchmark-stage-bar" aria-hidden>
                        <span style={{ width: `${(stage.avgLoadDurationMs / Math.max(total, 1)) * 100}%`, background: "var(--status-warning)" }} />
                        <span style={{ width: `${(stage.avgPromptEvalDurationMs / Math.max(total, 1)) * 100}%`, background: "var(--primary)" }} />
                        <span style={{ width: `${(stage.avgEvalDurationMs / Math.max(total, 1)) * 100}%`, background: "var(--status-success)" }} />
                        <span style={{ width: `${(stage.avgNonModelOverheadMs / Math.max(total, 1)) * 100}%`, background: "var(--border-strong)" }} />
                      </div>
                      <p className="helper-text">
                        load {formatDurationMs(stage.avgLoadDurationMs)} · prompt {formatDurationMs(stage.avgPromptEvalDurationMs)} · decode {formatDurationMs(stage.avgEvalDurationMs)} · overhead {formatDurationMs(stage.avgNonModelOverheadMs)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="grid two-up">
            <div className="detail-block">
              <div className="detail-block-header">
                <div>
                  <h3>Category Breakdown</h3>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Count</th>
                      <th>Exact</th>
                      <th>Avoid</th>
                      <th>Mean</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRunSummary.overall.categoryBreakdown.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td>{row.count}</td>
                        <td>{Math.round(row.quality.positiveExactHitRate * 100)}%</td>
                        <td>{Math.round(row.quality.negativeAvoidRate * 100)}%</td>
                        <td>{formatDurationMs(row.latency.mean)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="detail-block">
              <div className="detail-block-header">
                <div>
                  <h3>Source Breakdown</h3>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Winner Source</th>
                      <th>Count</th>
                      <th>Share</th>
                      <th>Mean</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRunSummary.overall.sourceBreakdown.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td>{row.count}</td>
                        <td>{Math.round(row.share * 100)}%</td>
                        <td>{formatDurationMs(row.latency.mean)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="detail-block">
            <div className="detail-block-header">
              <div>
                <h3>Attempt Table</h3>
                <p className="helper-text">
                  Filter by model, category, label kind, start state, or search across case names and commands.
                </p>
              </div>
            </div>
            <div className="form-grid compact">
              <label>
                Model
                <select
                  value={resultFilters.model}
                  onChange={(event) => setResultFilters((current) => ({ ...current, model: event.target.value }))}
                >
                  <option value="all">All</option>
                  {[...new Set(selectedRunResults.map((row) => row.modelName))].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  value={resultFilters.category}
                  onChange={(event) => setResultFilters((current) => ({ ...current, category: event.target.value }))}
                >
                  <option value="all">All</option>
                  {[...new Set(selectedRunResults.map((row) => row.category))].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Label kind
                <select
                  value={resultFilters.labelKind}
                  onChange={(event) => setResultFilters((current) => ({ ...current, labelKind: event.target.value }))}
                >
                  <option value="all">All</option>
                  <option value="positive">positive</option>
                  <option value="negative">negative</option>
                </select>
              </label>
              <label>
                Start state
                <select
                  value={resultFilters.startState}
                  onChange={(event) => setResultFilters((current) => ({ ...current, startState: event.target.value }))}
                >
                  <option value="all">All</option>
                  <option value="cold">cold</option>
                  <option value="hot">hot</option>
                  <option value="unknown">unknown</option>
                  <option value="not_applicable">not applicable</option>
                </select>
              </label>
              <label>
                Search
                <input
                  value={resultFilters.query}
                  onChange={(event) => setResultFilters((current) => ({ ...current, query: event.target.value }))}
                  placeholder="case or command"
                />
              </label>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Case</th>
                    <th>Phase</th>
                    <th>Latency</th>
                    <th>Start</th>
                    <th>Match</th>
                    <th>Winner</th>
                    <th>Target</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRunResults.map((result) => (
                    <tr key={result.id}>
                      <td>{result.modelName}</td>
                      <td>{result.caseName}</td>
                      <td>{result.timingPhase}</td>
                      <td>{formatDurationMs(result.requestLatencyMs)}</td>
                      <td>{result.startState}</td>
                      <td>
                        {result.labelKind === "negative"
                          ? result.negativeAvoided
                            ? "avoid"
                            : "miss"
                          : result.exactMatch
                            ? "exact"
                            : result.alternativeMatch
                              ? "alt"
                              : "miss"}
                      </td>
                      <td>
                        <code>{result.winnerCommand || "No winner"}</code>
                      </td>
                      <td>
                        <code>{result.expectedCommand || result.negativeTarget || "n/a"}</code>
                      </td>
                      <td>{result.errorText || result.modelError || "n/a"}</td>
                    </tr>
                  ))}
                  {filteredRunResults.length === 0 ? (
                    <tr>
                      <td colSpan={9}>No attempts matched the current filters.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <div className="detail-block">
            <div className="detail-block-header">
              <div>
                <h3>Worker Log</h3>
                <p className="helper-text">
                  Live benchmark worker stdout and stderr for this run.
                </p>
              </div>
            </div>
            <pre
              ref={workerLogRef}
              className="code-block benchmark-log-block"
              onScroll={(event) => {
                const container = event.currentTarget;
                const distanceFromBottom =
                  container.scrollHeight - container.clientHeight - container.scrollTop;
                shouldFollowWorkerLogRef.current = distanceFromBottom <= 12;
              }}
            >
              {selectedRunLogText || "No benchmark log output yet."}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
