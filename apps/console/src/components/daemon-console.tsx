"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { ModelPicker } from "@/components/model-picker";
import { PathHoverActions } from "@/components/path-hover-actions";
import { SuggestStrategyField } from "@/components/suggest-strategy-field";
import { formatTimestamp } from "@/lib/format";
import type {
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

const CONFIRMATIONS: Record<ClearDataset, string> = {
  suggestions: "DELETE_SUGGESTIONS",
  feedback: "DELETE_FEEDBACK",
  benchmarks: "DELETE_BENCHMARKS",
};

export function DaemonConsole({
  initialStatus,
  initialLog,
  initialAvailableModels,
}: DaemonConsoleProps) {
  const [status, setStatus] = useState(initialStatus);
  const [observedAtMs, setObservedAtMs] = useState<number | null>(null);
  const [logText, setLogText] = useState(initialLog);
  const [availableModels, setAvailableModels] = useState(initialAvailableModels);
  const [settings, setSettings] = useState({
    LAC_MODEL_NAME: initialStatus.settings.modelName,
    LAC_MODEL_BASE_URL: initialStatus.settings.modelBaseUrl,
    LAC_SUGGEST_STRATEGY: initialStatus.settings.suggestStrategy,
    LAC_SOCKET_PATH: initialStatus.settings.socketPath,
    LAC_DB_PATH: initialStatus.settings.dbPath,
    LAC_SUGGEST_TIMEOUT_MS: String(initialStatus.settings.suggestTimeoutMs),
  });
  const [confirmations, setConfirmations] = useState<Record<ClearDataset, string>>({
    suggestions: "",
    feedback: "",
    benchmarks: "",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [installPrompt, setInstallPrompt] = useState<{
    modelName: string;
    pendingSave: boolean;
  } | null>(null);
  const [installState, setInstallState] = useState<{
    job: OllamaInstallJob;
    pendingSave: boolean;
  } | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pendingSaveAfterInstallRef = useRef(false);
  const pathRows = [
    { label: "State dir", value: status.settings.stateDir },
    { label: "Runtime env", value: status.settings.runtimeEnvPath },
    { label: "PID file", value: status.pidPath },
    { label: "Log file", value: status.logPath },
  ] as const;

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

  const refreshRuntime = useCallback(async () => {
    const response = await fetch("/api/runtime");
    const data = (await response.json()) as RuntimeStatus & { recentLog: string; error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Unable to refresh runtime");
    }
    setStatus(data);
    setObservedAtMs(Date.now());
    setLogText(data.recentLog);
    setSettings({
      LAC_MODEL_NAME: data.settings.modelName,
      LAC_MODEL_BASE_URL: data.settings.modelBaseUrl,
      LAC_SUGGEST_STRATEGY: data.settings.suggestStrategy,
      LAC_SOCKET_PATH: data.settings.socketPath,
      LAC_DB_PATH: data.settings.dbPath,
      LAC_SUGGEST_TIMEOUT_MS: String(data.settings.suggestTimeoutMs),
    });
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setObservedAtMs(Date.now());

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

    return () => {
      cancelled = true;
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, [refreshAvailableModels, refreshRuntime]);

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
        await refreshAvailableModels(settings.LAC_MODEL_BASE_URL);
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
          baseUrl: settings.LAC_MODEL_BASE_URL,
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
            <SuggestStrategyField
              value={settings.LAC_SUGGEST_STRATEGY}
              onChange={(value) =>
                setSettings((current) => ({ ...current, LAC_SUGGEST_STRATEGY: value }))
              }
            />
            <label>
              Model Base URL
              <input
                value={settings.LAC_MODEL_BASE_URL}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    LAC_MODEL_BASE_URL: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Socket Path
              <PathHoverActions
                pathValue={settings.LAC_SOCKET_PATH}
                label="Socket path"
                variant="input"
              >
                <input
                  value={settings.LAC_SOCKET_PATH}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, LAC_SOCKET_PATH: event.target.value }))
                  }
                />
              </PathHoverActions>
            </label>
            <label>
              Database Path
              <PathHoverActions
                pathValue={settings.LAC_DB_PATH}
                label="Database path"
                variant="input"
              >
                <input
                  value={settings.LAC_DB_PATH}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, LAC_DB_PATH: event.target.value }))
                  }
                />
              </PathHoverActions>
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
            <button type="submit" disabled={busy !== ""}>
              {busy === "settings" ? "Saving..." : "Save Settings"}
            </button>
          </form>
        </div>

        <div className="detail-block">
          <h3>Paths</h3>
          <dl className="meta-list path-meta-list">
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
              <dt>Observed</dt>
              <dd>{observedAtMs ? formatTimestamp(observedAtMs) : "Waiting for client sync..."}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="detail-block">
        <div className="result-card-header">
          <h3>Recent Daemon Log</h3>
          <button type="button" className="button-secondary" onClick={() => void refreshRuntime()}>
            Refresh Log
          </button>
        </div>
        <pre className="code-block code-block-tall">{logText || "No daemon log output yet."}</pre>
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
        <div className="stack-sm danger-zone-content">
          {(["suggestions", "feedback", "benchmarks"] as ClearDataset[]).map((dataset) => (
            <div key={dataset} className="destructive-card">
              <strong>{dataset}</strong>
              <p className="muted-text">
                Type <code>{CONFIRMATIONS[dataset]}</code> to confirm.
              </p>
              <input
                value={confirmations[dataset]}
                onChange={(event) =>
                  setConfirmations((current) => ({
                    ...current,
                    [dataset]: event.target.value,
                  }))
                }
              />
              <button
                type="button"
                className="button-danger"
                disabled={busy !== ""}
                onClick={() => void clearDataset(dataset)}
              >
                Clear {dataset}
              </button>
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
