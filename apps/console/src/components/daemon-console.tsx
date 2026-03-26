"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";

import { ModelPicker } from "@/components/model-picker";
import { PathHoverActions } from "@/components/path-hover-actions";
import { SuggestStrategyField } from "@/components/suggest-strategy-field";
import { useJsonEventStream, type LiveStreamStatus } from "@/components/use-json-event-stream";
import { DEFAULT_SYSTEM_PROMPT_STATIC } from "@/lib/default-system-prompt";
import { formatBytes, formatTimestamp } from "@/lib/format";
import { formatPtyCaptureListForEditor } from "@/lib/pty-capture-list";
import type {
  AcceptSuggestionKey,
  ClearDataset,
  OllamaInstallJob,
  OllamaModelOption,
  RuntimeStatus,
} from "@/lib/types";

interface DaemonConsoleProps {
  initialStatus: RuntimeStatus;
  initialLog: string;
  initialAvailableModels: OllamaModelOption[];
}

type LastSeenModelMemory = {
  modelLoadedBytes: number | null;
  modelVramBytes: number | null;
  totalTrackedBytes: number | null;
  observedAtMs: number;
};

const CONFIRMATIONS: Record<ClearDataset, string> = {
  suggestions: "DELETE_SUGGESTIONS",
  feedback: "DELETE_FEEDBACK",
  benchmarks: "DELETE_BENCHMARKS",
};
const LAST_SEEN_MEMORY_STORAGE_KEY = "lac-daemon-last-seen-memory-v1";
const DEFAULT_MODEL_KEEP_ALIVE = "5m";

function normalizeModelMemoryKey(modelName: string) {
  return modelName.trim().toLowerCase();
}

function readLastSeenModelMemory() {
  if (typeof window === "undefined") {
    return {} as Record<string, LastSeenModelMemory>;
  }

  try {
    const raw = window.localStorage.getItem(LAST_SEEN_MEMORY_STORAGE_KEY);
    if (!raw) {
      return {} as Record<string, LastSeenModelMemory>;
    }

    const parsed = JSON.parse(raw) as Record<string, LastSeenModelMemory>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {} as Record<string, LastSeenModelMemory>;
  }
}

function formatStreamStatus(status: LiveStreamStatus) {
  if (status === "live") {
    return "Live";
  }
  if (status === "reconnecting") {
    return "Reconnecting";
  }
  return "Connecting";
}

export function DaemonConsole({
  initialStatus,
  initialLog,
  initialAvailableModels,
}: DaemonConsoleProps) {
  const initialModelKeepAlive =
    initialStatus.settings.modelKeepAlive || DEFAULT_MODEL_KEEP_ALIVE;
  const [status, setStatus] = useState(initialStatus);
  const [observedAtMs, setObservedAtMs] = useState<number | null>(null);
  const [logText, setLogText] = useState(initialLog);
  const [availableModels, setAvailableModels] = useState(initialAvailableModels);
  const [settings, setSettings] = useState({
    LAC_MODEL_NAME: initialStatus.settings.modelName,
    LAC_FAST_MODEL_NAME: initialStatus.settings.fastModelName,
    LAC_MODEL_KEEP_ALIVE: initialModelKeepAlive,
    LAC_SUGGEST_STRATEGY: initialStatus.settings.suggestStrategy,
    LAC_SYSTEM_PROMPT_STATIC: initialStatus.settings.systemPromptStatic,
    LAC_SUGGEST_TIMEOUT_MS: String(initialStatus.settings.suggestTimeoutMs),
    LAC_ACCEPT_KEY: initialStatus.settings.acceptKey,
    LAC_PTY_CAPTURE_MODE: initialStatus.settings.ptyCaptureMode,
    LAC_PTY_CAPTURE_ALLOWLIST: formatPtyCaptureListForEditor(initialStatus.settings.ptyCaptureAllowlist),
    LAC_PTY_CAPTURE_BLOCKLIST: formatPtyCaptureListForEditor(initialStatus.settings.ptyCaptureBlocklist),
  });
  const [confirmations, setConfirmations] = useState<Record<ClearDataset, string>>({
    suggestions: "",
    feedback: "",
    benchmarks: "",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [lastSeenMemoryByModel, setLastSeenMemoryByModel] = useState<Record<string, LastSeenModelMemory>>({});
  const [installPrompt, setInstallPrompt] = useState<{
    modelName: string;
    pendingSave: boolean;
  } | null>(null);
  const [installState, setInstallState] = useState<{
    job: OllamaInstallJob;
    pendingSave: boolean;
  } | null>(null);
  const [logStreamKey, setLogStreamKey] = useState(0);
  const pollTimerRef = useRef<number | null>(null);
  const runtimeRefreshTimerRef = useRef<number | null>(null);
  const pendingSaveAfterInstallRef = useRef(false);
  const systemPromptFieldId = useId();
  const acceptKeyFieldId = useId();
  const ptyCaptureFieldId = useId();
  const modelBaseUrl = status.settings.modelBaseUrl;
  const runtimeValueRows = [
    { label: "Model Base URL", value: modelBaseUrl },
  ] as const;
  const pathRows = [
    { label: "Socket Path", value: status.settings.socketPath },
    { label: "Database Path", value: status.settings.dbPath },
    { label: "State dir", value: status.settings.stateDir },
    { label: "Runtime env", value: status.settings.runtimeEnvPath },
    { label: "PID file", value: status.pidPath },
    { label: "Log file", value: status.logPath },
  ] as const;
  const logStreamStatus = useJsonEventStream<{ log?: string }>(
    `/api/runtime/log/stream?lines=160&streamKey=${logStreamKey}`,
    (payload) => {
      setLogText(payload.log || "");
    },
  );
  const activeModelLabel = status.memory.modelName || status.health.modelName || status.settings.modelName;
  const activeModelKey = normalizeModelMemoryKey(activeModelLabel);
  const lastSeenMemory = activeModelKey ? lastSeenMemoryByModel[activeModelKey] || null : null;
  const usingLastSeenMemory = status.memory.modelLoadedBytes === null && lastSeenMemory !== null;
  const displayedModelLoadedBytes =
    status.memory.modelLoadedBytes !== null
      ? status.memory.modelLoadedBytes
      : lastSeenMemory?.modelLoadedBytes ?? null;
  const displayedModelVramBytes =
    status.memory.modelVramBytes !== null
      ? status.memory.modelVramBytes
      : lastSeenMemory?.modelVramBytes ?? null;
  const displayedTotalTrackedBytes =
    status.memory.modelLoadedBytes !== null
      ? status.memory.totalTrackedBytes
      : lastSeenMemory?.totalTrackedBytes ?? status.memory.totalTrackedBytes;
  const modelMemoryText = displayedModelLoadedBytes !== null
    ? `${formatBytes(displayedModelLoadedBytes)} (${activeModelLabel})`
    : status.health.ok
      ? `${activeModelLabel} not currently loaded`
      : "daemon offline";
  const modelVramText = displayedModelVramBytes !== null
    ? formatBytes(displayedModelVramBytes)
    : status.health.ok
      ? "model not loaded"
      : "daemon offline";
  const totalTrackedText = displayedTotalTrackedBytes !== null
    ? usingLastSeenMemory
      ? `${formatBytes(displayedTotalTrackedBytes)} last seen`
      : status.memory.modelLoadedBytes !== null
        ? formatBytes(displayedTotalTrackedBytes)
        : `${formatBytes(displayedTotalTrackedBytes)} (daemon only)`
    : "n/a";
  const modelStateText = status.memory.modelLoadedBytes !== null
    ? "Active now"
    : lastSeenMemory
      ? `Inactive - last seen ${formatTimestamp(lastSeenMemory.observedAtMs)}`
      : status.health.ok
        ? "Inactive"
        : "Daemon offline";
  const ptyModeIsBlocklist = settings.LAC_PTY_CAPTURE_MODE === "blocklist";
  const activePtyListKey = ptyModeIsBlocklist
    ? "LAC_PTY_CAPTURE_BLOCKLIST"
    : "LAC_PTY_CAPTURE_ALLOWLIST";
  const activePtyListValue = settings[activePtyListKey];
  const activePtyListTitle = ptyModeIsBlocklist ? "PTY Capture Block List" : "PTY Capture Allow List";
  const activePtyListPlaceholder = ptyModeIsBlocklist
    ? "vim\n/^codex$/"
    : "git\n/^npm (run|test)$/";
  const activePtyListInfoTitle = ptyModeIsBlocklist
    ? "Enter one command name or one /regex/ per line. Plain lines match the executable name, while regex lines match the full command text before the lightweight PTY helper runs."
    : "Enter one command name or one /regex/ per line. Plain lines match the executable name, while regex lines match the full command text before the lightweight PTY helper runs. This affects new shells after they reload the plugin; the daemon restart is harmless but not what makes the setting take effect.";
  const ptyModeHelpText = ptyModeIsBlocklist
    ? "Enter one command name or /regex/ per line. Plain lines match the executable name, while regex lines match the full command text, so /^codex$/ blocks only bare codex and still allows codex exec .... Use the block list when the lightweight PTY shell can mess up complex interactive CLI tools. Shell builtins still use the normal shell path."
    : "Enter one command name or /regex/ per line. Plain lines match the executable name, while regex lines match the full command text. Use the allow list when you only want to send specific commands through the lightweight PTY shell because more complex interactive CLI tools can get confused by it.";

  function findModelOption(modelName: string) {
    const normalized = modelName.trim();
    return availableModels.find((option) => option.name === normalized);
  }

  function shouldPromptToInstall(modelName: string) {
    const option = findModelOption(modelName);
    return Boolean(option && !option.installed);
  }

  const refreshAvailableModels = useCallback(async (baseUrl: string) => {
    const response = await fetch(
      `/api/ollama/models?baseUrl=${encodeURIComponent(baseUrl)}`,
    );
    const data = (await response.json()) as {
      models?: OllamaModelOption[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error || "Unable to refresh model inventory");
    }
    setAvailableModels(data.models || []);
  }, []);

  const refreshDaemonLog = useCallback(async () => {
    const response = await fetch("/api/runtime/log?lines=160", { cache: "no-store" });
    const data = (await response.json()) as { log?: string; error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Unable to refresh daemon log");
    }
    setLogText(data.log || "");
  }, []);

  const refreshRuntime = useCallback(async (syncSettings = true) => {
    const response = await fetch("/api/runtime", { cache: "no-store" });
    const data = (await response.json()) as RuntimeStatus & { recentLog: string; error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Unable to refresh runtime");
    }
    setStatus(data);
    setObservedAtMs(Date.now());
    if (syncSettings) {
      setSettings({
        LAC_MODEL_NAME: data.settings.modelName,
        LAC_FAST_MODEL_NAME: data.settings.fastModelName,
        LAC_MODEL_KEEP_ALIVE: data.settings.modelKeepAlive || DEFAULT_MODEL_KEEP_ALIVE,
        LAC_SUGGEST_STRATEGY: data.settings.suggestStrategy,
        LAC_SYSTEM_PROMPT_STATIC: data.settings.systemPromptStatic,
        LAC_SUGGEST_TIMEOUT_MS: String(data.settings.suggestTimeoutMs),
        LAC_ACCEPT_KEY: data.settings.acceptKey,
        LAC_PTY_CAPTURE_MODE: data.settings.ptyCaptureMode,
        LAC_PTY_CAPTURE_ALLOWLIST: formatPtyCaptureListForEditor(data.settings.ptyCaptureAllowlist),
        LAC_PTY_CAPTURE_BLOCKLIST: formatPtyCaptureListForEditor(data.settings.ptyCaptureBlocklist),
      });
    }
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setObservedAtMs(Date.now());
    setLastSeenMemoryByModel(readLastSeenModelMemory());

    async function syncFromRuntime() {
      try {
        const data = await refreshRuntime();
        if (!cancelled) {
          await refreshAvailableModels(data.settings.modelBaseUrl);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error ? requestError.message : "Unable to refresh runtime",
          );
        }
      }
    }

    void syncFromRuntime();

    const refreshStatusOnly = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void refreshRuntime(false).catch((requestError) => {
        if (!cancelled) {
          setError(
            requestError instanceof Error ? requestError.message : "Unable to refresh runtime",
          );
        }
      });
    };

    runtimeRefreshTimerRef.current = window.setInterval(refreshStatusOnly, 5000);
    window.addEventListener("focus", refreshStatusOnly);
    document.addEventListener("visibilitychange", refreshStatusOnly);

    return () => {
      cancelled = true;
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
      if (runtimeRefreshTimerRef.current !== null) {
        window.clearInterval(runtimeRefreshTimerRef.current);
      }
      window.removeEventListener("focus", refreshStatusOnly);
      document.removeEventListener("visibilitychange", refreshStatusOnly);
    };
  }, [refreshAvailableModels, refreshRuntime]);

  useEffect(() => {
    if (!activeModelKey || status.memory.modelLoadedBytes === null) {
      return;
    }

    const nextSnapshot: LastSeenModelMemory = {
      modelLoadedBytes: status.memory.modelLoadedBytes,
      modelVramBytes: status.memory.modelVramBytes,
      totalTrackedBytes: status.memory.totalTrackedBytes,
      observedAtMs: observedAtMs || Date.now(),
    };

    setLastSeenMemoryByModel((current) => {
      const existing = current[activeModelKey];
      if (
        existing?.modelLoadedBytes === nextSnapshot.modelLoadedBytes &&
        existing?.modelVramBytes === nextSnapshot.modelVramBytes &&
        existing?.totalTrackedBytes === nextSnapshot.totalTrackedBytes &&
        existing?.observedAtMs === nextSnapshot.observedAtMs
      ) {
        return current;
      }

      const next = {
        ...current,
        [activeModelKey]: nextSnapshot,
      };

      try {
        window.localStorage.setItem(LAST_SEEN_MEMORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore persistence failures and keep the in-memory fallback.
      }

      return next;
    });
  }, [activeModelKey, observedAtMs, status.memory.modelLoadedBytes, status.memory.modelVramBytes, status.memory.totalTrackedBytes]);

  async function persistSettings(nextMessage = "Runtime settings saved to runtime.env.") {
    const response = await fetch("/api/runtime/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Unable to save settings");
    }
    setMessage(nextMessage);
    await refreshRuntime();
  }

  async function applySettings(nextMessage?: string) {
    setBusy("settings");
    setError("");
    setMessage("");
    try {
      await persistSettings("Runtime settings saved. Restarting daemon with the new configuration...");

      const response = await fetch("/api/runtime/restart", { method: "POST" });
      const data = (await response.json()) as RuntimeStatus & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to restart daemon with new settings");
      }
      setStatus(data);
      setMessage(nextMessage || "Runtime settings saved and daemon restarted.");
      await refreshRuntime();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to apply settings");
    } finally {
      setBusy("");
    }
  }

  async function performRuntimeAction(endpoint: string, nextMessage: string) {
    setBusy(endpoint);
    setError("");
    setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const data = (await response.json()) as RuntimeStatus & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "runtime action failed");
      }
      setStatus(data);
      setMessage(nextMessage);
      await refreshRuntime();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "runtime action failed");
    } finally {
      setBusy("");
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (shouldPromptToInstall(settings.LAC_MODEL_NAME)) {
      setInstallPrompt({
        modelName: settings.LAC_MODEL_NAME.trim(),
        pendingSave: true,
      });
      setMessage("");
      setError("");
      return;
    }
    await applySettings();
  }

  function scheduleInstallPoll(jobId: string) {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
    }
    pollTimerRef.current = window.setTimeout(() => {
      void pollInstallStatus(jobId);
    }, 700);
  }

  async function pollInstallStatus(jobId: string) {
    try {
      const response = await fetch(`/api/ollama/install/${jobId}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        job?: OllamaInstallJob;
        error?: string;
      };
      if (!response.ok || !data.job) {
        throw new Error(data.error || "Unable to fetch install progress");
      }

      setInstallState((current) => ({
        job: data.job as OllamaInstallJob,
        pendingSave: current?.pendingSave || false,
      }));

      if (data.job.status === "pending" || data.job.status === "running") {
        scheduleInstallPoll(jobId);
        return;
      }

      pollTimerRef.current = null;

      if (data.job.status === "completed") {
        await refreshAvailableModels(modelBaseUrl);
        const pendingSave = pendingSaveAfterInstallRef.current;
        pendingSaveAfterInstallRef.current = false;
        if (pendingSave) {
          await applySettings(`${data.job.model} downloaded. Runtime settings saved and applied.`);
        } else {
          setMessage(`${data.job.model} downloaded from Ollama.`);
        }
        return;
      }

      pendingSaveAfterInstallRef.current = false;
      setError(data.job.error || `${data.job.model} download failed.`);
    } catch (requestError) {
      pendingSaveAfterInstallRef.current = false;
      setError(
        requestError instanceof Error ? requestError.message : "Unable to fetch install progress",
      );
    }
  }

  async function startModelDownload(modelName: string, pendingSave: boolean) {
    setInstallPrompt(null);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/ollama/install", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          baseUrl: modelBaseUrl,
        }),
      });
      const data = (await response.json()) as {
        job?: OllamaInstallJob;
        error?: string;
      };
      if (!response.ok || !data.job) {
        throw new Error(data.error || "Unable to start model download");
      }

      setInstallState({
        job: data.job,
        pendingSave,
      });
      pendingSaveAfterInstallRef.current = pendingSave;
      scheduleInstallPoll(data.job.id);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to start model download",
      );
    }
  }

  async function clearDataset(dataset: ClearDataset) {
    setBusy(`clear-${dataset}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/data/clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataset,
          confirmation: confirmations[dataset],
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to clear data");
      }
      setMessage(`${dataset} data cleared.`);
      setConfirmations((current) => ({ ...current, [dataset]: "" }));
      await refreshRuntime();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to clear data");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="stack-lg">
      <div className="hero-card">
        <div className="hero-card-topline">Daemon status</div>
        <h3>{status.health.ok ? "Healthy" : "Offline"}</h3>
        <p>
          Model: <code>{status.health.modelName}</code> · Socket:{" "}
          <PathHoverActions pathValue={status.health.socket} label="Daemon socket" variant="inline">
            <code>{status.health.socket}</code>
          </PathHoverActions>
        </p>
        {status.health.error ? <p className="error-text">{status.health.error}</p> : null}
        <div className="inline-actions">
          <button
            type="button"
            onClick={() => void performRuntimeAction("/api/runtime/start", "Daemon started.")}
            disabled={busy !== ""}
          >
            Start
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void performRuntimeAction("/api/runtime/restart", "Daemon restarted.")}
            disabled={busy !== ""}
          >
            Restart
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void performRuntimeAction("/api/runtime/stop", "Daemon stopped.")}
            disabled={busy !== ""}
          >
            Stop
          </button>
          <button type="button" className="button-secondary" onClick={() => void refreshRuntime()}>
            Refresh
          </button>
          {message ? <p className="success-text">{message}</p> : null}
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="grid two-up">
        <div className="detail-block">
          <h3>Runtime Settings</h3>
          <form className="stack-sm" onSubmit={saveSettings}>
            <ModelPicker
              mode="single"
              label="Model Name"
              value={settings.LAC_MODEL_NAME}
              options={availableModels}
              installedOnly
              onValueChange={(value) => {
                setSettings((current) => ({ ...current, LAC_MODEL_NAME: value }));
                if (!shouldPromptToInstall(value)) {
                  setInstallPrompt(null);
                }
              }}
              onSelect={(value) => {
                if (shouldPromptToInstall(value)) {
                  setInstallPrompt({
                    modelName: value,
                    pendingSave: false,
                  });
                }
              }}
              placeholder="Select an installed model"
              helperText={
                <>
                  Only installed models appear here. Download additional models from the{" "}
                  <Link href="/models">Models</Link> page.
                </>
              }
              emptyMessage={
                <>
                  No matching installed models. Download additional models from the{" "}
                  <Link href="/models">Models</Link> page.
                </>
              }
            />
            <ModelPicker
              mode="single"
              label="Fast Stage Model"
              value={settings.LAC_FAST_MODEL_NAME}
              options={availableModels}
              installedOnly
              onValueChange={(value) =>
                setSettings((current) => ({ ...current, LAC_FAST_MODEL_NAME: value }))
              }
              placeholder="Optional fast model for staged refinement"
              helperText={
                'Used by the "History then fast then large model" and "Fast then large models" strategies. Leave blank to skip the fast-model stage.'
              }
              emptyMessage={
                <>
                  No matching installed models. Download additional models from the{" "}
                  <Link href="/models">Models</Link> page.
                </>
              }
            />
            <SuggestStrategyField
              value={settings.LAC_SUGGEST_STRATEGY}
              onChange={(value) =>
                setSettings((current) => ({ ...current, LAC_SUGGEST_STRATEGY: value }))
              }
            />
            <label>
              <span className="label-with-info">
                Model Keep Alive
                <span
                  className="info-bubble"
                  title="Passed through to Ollama as keep_alive on inference requests. Use values like 5m, 30m, 1h, or 0 to unload immediately after each request."
                >
                  <Info aria-hidden="true" />
                </span>
              </span>
              <input
                value={settings.LAC_MODEL_KEEP_ALIVE || DEFAULT_MODEL_KEEP_ALIVE}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    LAC_MODEL_KEEP_ALIVE: event.target.value,
                  }))
                }
                placeholder="5m"
              />
            </label>
            <label>
              Suggest Timeout (ms)
              <input
                value={settings.LAC_SUGGEST_TIMEOUT_MS}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    LAC_SUGGEST_TIMEOUT_MS: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Accept Suggestion Key
              <select
                id={acceptKeyFieldId}
                value={settings.LAC_ACCEPT_KEY}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    LAC_ACCEPT_KEY: event.target.value as AcceptSuggestionKey,
                  }))
                }
              >
                <option value="tab">Tab</option>
                <option value="right-arrow">Right Arrow</option>
              </select>
            </label>
            <p className="helper-text">
              Chooses which key accepts a visible ghost-text suggestion in new shells. When set to Right Arrow,
              Tab returns to normal completion and Right Arrow accepts the suggestion only when one is visible;
              otherwise it keeps moving the cursor right.
            </p>
            <div className="field-group">
              <span className="field-header field-header-with-toggle">
                <span className="label-with-info">
                  <label htmlFor={ptyCaptureFieldId} className="field-label">
                    {activePtyListTitle}
                  </label>
                  <span className="info-bubble" title={activePtyListInfoTitle}>
                    <Info aria-hidden="true" />
                  </span>
                </span>
                <span className="mode-toggle-group" role="group" aria-label="PTY capture mode">
                  <button
                    type="button"
                    className={
                      settings.LAC_PTY_CAPTURE_MODE === "allowlist"
                        ? "mode-toggle-button active"
                        : "mode-toggle-button"
                    }
                    aria-pressed={settings.LAC_PTY_CAPTURE_MODE === "allowlist"}
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        LAC_PTY_CAPTURE_MODE: "allowlist",
                      }))
                    }
                  >
                    Allowlist
                  </button>
                  <button
                    type="button"
                    className={
                      settings.LAC_PTY_CAPTURE_MODE === "blocklist"
                        ? "mode-toggle-button active"
                        : "mode-toggle-button"
                    }
                    aria-pressed={settings.LAC_PTY_CAPTURE_MODE === "blocklist"}
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        LAC_PTY_CAPTURE_MODE: "blocklist",
                      }))
                    }
                  >
                    Blocklist
                  </button>
                </span>
              </span>
              <textarea
                id={ptyCaptureFieldId}
                value={activePtyListValue}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    [activePtyListKey]: event.target.value,
                  }))
                }
                rows={6}
                placeholder={activePtyListPlaceholder}
              />
            </div>
            <p className="helper-text">{ptyModeHelpText}</p>
            <div className="field-group">
              <span className="field-header field-header-with-actions">
                <label htmlFor={systemPromptFieldId} className="field-label">
                  System Prompt
                </label>
                <button
                  type="button"
                  className="button-secondary inline-field-button"
                  onClick={() =>
                    setSettings((current) => ({
                      ...current,
                      LAC_SYSTEM_PROMPT_STATIC: DEFAULT_SYSTEM_PROMPT_STATIC,
                    }))
                  }
                >
                  Reset
                </button>
              </span>
              <textarea
                id={systemPromptFieldId}
                value={settings.LAC_SYSTEM_PROMPT_STATIC}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    LAC_SYSTEM_PROMPT_STATIC: event.target.value,
                  }))
                }
                rows={8}
                placeholder="Edit the default shell autosuggestion system prompt."
              />
            </div>
            <p className="helper-text">
              Used verbatim as the system prompt on new daemon requests. Reset restores the built-in default.
              Save settings to persist it to runtime.env and restart the daemon.
            </p>
            <button type="submit" disabled={busy !== ""}>
              {busy === "settings" ? "Saving..." : "Save Settings"}
            </button>
          </form>
        </div>

        <div className="detail-block">
          <h3>Runtime Details</h3>
          <dl className="meta-list path-meta-list">
            {runtimeValueRows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>
                  <code className="path-value">{row.value}</code>
                </dd>
              </div>
            ))}
            {pathRows.map((row) => (
              <div key={row.label} className="path-row">
                <dt>{row.label}</dt>
                <dd>
                  <PathHoverActions pathValue={row.value} label={row.label} className="path-value-row">
                    <code className="path-value">{row.value}</code>
                  </PathHoverActions>
                </dd>
              </div>
            ))}
            <div>
              <dt>PID</dt>
              <dd>{status.pid || "offline"}</dd>
            </div>
            <div>
              <dt>Daemon RSS</dt>
              <dd>{formatBytes(status.memory.daemonRssBytes)}</dd>
            </div>
            <div>
              <dt>Model Memory</dt>
              <dd className={usingLastSeenMemory ? "memory-value memory-value-stale" : "memory-value"}>
                <span>{modelMemoryText}</span>
              </dd>
            </div>
            <div>
              <dt>Model VRAM</dt>
              <dd className={usingLastSeenMemory ? "memory-value memory-value-stale" : "memory-value"}>
                <span>{modelVramText}</span>
              </dd>
            </div>
            <div>
              <dt>Total Tracked</dt>
              <dd className={usingLastSeenMemory ? "memory-value memory-value-stale" : "memory-value"}>
                <span>{totalTrackedText}</span>
              </dd>
            </div>
            <div>
              <dt>Model State</dt>
              <dd className={usingLastSeenMemory ? "memory-value memory-value-stale" : "memory-value memory-value-status"}>
                <span>{modelStateText}</span>
              </dd>
            </div>
            <div>
              <dt>Observed</dt>
              <dd>{observedAtMs ? formatTimestamp(observedAtMs) : "Waiting for client sync..."}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="detail-block">
        <div className="result-card-header">
          <h3>Recent Daemon Log</h3>
          <div className="stream-header-actions">
            <span className={`stream-indicator stream-indicator-${logStreamStatus}`}>
              {formatStreamStatus(logStreamStatus)}
            </span>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setLogStreamKey((current) => current + 1);
                void refreshDaemonLog();
              }}
            >
              Refresh Log
            </button>
          </div>
        </div>
        <pre className="code-block code-block-tall" aria-live="polite">
          {logText || "No daemon log output yet."}
        </pre>
      </div>

      <div className="detail-block">
        <div className="detail-block-header">
          <div>
            <h3>Danger Zone</h3>
            <p className="helper-text">
              These actions permanently remove local data from the control app and daemon history.
            </p>
          </div>
        </div>
        <div className="danger-zone-content">
          {(["suggestions", "feedback", "benchmarks"] as ClearDataset[]).map((dataset) => (
            <div key={dataset} className="danger-zone-row">
              <div className="danger-zone-copy">
                <strong>{dataset}</strong>
                <p className="muted-text">
                  Permanently delete stored {dataset} data from this local control app.
                </p>
                <label className="danger-zone-confirmation">
                  <span>Confirm with <code>{CONFIRMATIONS[dataset]}</code></span>
                  <input
                    value={confirmations[dataset]}
                    onChange={(event) =>
                      setConfirmations((current) => ({
                        ...current,
                        [dataset]: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <div className="danger-zone-actions">
                <button
                  type="button"
                  className="button-danger"
                  disabled={busy !== ""}
                  onClick={() => void clearDataset(dataset)}
                >
                  Clear {dataset}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="toast-stack" aria-live="polite">
        {installPrompt ? (
          <div className="toast toast-warning" role="status">
            <div className="toast-title">Download {installPrompt.modelName}?</div>
            <p className="toast-body">
              This model is available in Ollama but is not installed locally yet.
            </p>
            <div className="toast-actions">
              <button
                type="button"
                onClick={() =>
                  void startModelDownload(
                    installPrompt.modelName,
                    installPrompt.pendingSave,
                  )
                }
              >
                Download Model
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setInstallPrompt(null)}
              >
                Not now
              </button>
            </div>
          </div>
        ) : null}

        {installState ? (
          <div
            className={
              installState.job.status === "failed"
                ? "toast toast-error"
                : installState.job.status === "completed"
                  ? "toast toast-success"
                  : "toast"
            }
            role="status"
          >
            <div className="toast-title">
              {installState.job.status === "completed"
                ? `${installState.job.model} ready`
                : installState.job.status === "failed"
                  ? `${installState.job.model} failed`
                  : `Downloading ${installState.job.model}`}
            </div>
            <p className="toast-body">{installState.job.error || installState.job.message}</p>
            <div className="toast-progress">
              <div
                className="toast-progress-fill"
                style={{ width: `${Math.max(6, installState.job.progressPercent)}%` }}
              />
            </div>
            <div className="toast-footer">
              <span>
                {installState.job.status === "completed"
                  ? "100%"
                  : `${installState.job.progressPercent}%`}
              </span>
              {installState.job.status === "completed" ||
              installState.job.status === "failed" ? (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setInstallState(null)}
                >
                  Dismiss
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
