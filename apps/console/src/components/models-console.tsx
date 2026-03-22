"use client";

import { Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import type {
  OllamaInstallJob,
  OllamaModelOption,
  RuntimeStatus,
} from "@/lib/types";

interface ModelsConsoleProps {
  initialRuntime: RuntimeStatus;
  initialModels: OllamaModelOption[];
  initialInstalledCount: number;
  initialLibraryCount: number;
  initialInstalledError?: string;
  initialLibraryError?: string;
}

export function ModelsConsole({
  initialRuntime,
  initialModels,
  initialInstalledCount,
  initialLibraryCount,
  initialInstalledError = "",
  initialLibraryError = "",
}: ModelsConsoleProps) {
  const AVAILABLE_PAGE_SIZE = 24;
  const [runtime, setRuntime] = useState(initialRuntime);
  const [models, setModels] = useState(initialModels);
  const [inventorySummary, setInventorySummary] = useState({
    installedCount: initialInstalledCount,
    libraryCount: initialLibraryCount,
    installedError: initialInstalledError,
    libraryError: initialLibraryError,
  });
  const [downloadModel, setDownloadModel] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [installPrompt, setInstallPrompt] = useState<string | null>(null);
  const [installState, setInstallState] = useState<OllamaInstallJob | null>(null);
  const [removePrompt, setRemovePrompt] = useState<string | null>(null);
  const [availablePage, setAvailablePage] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  const configuredModel = runtime.settings.modelName;
  const modelIsLive = runtime.health.ok && runtime.health.modelName === configuredModel;

  const filteredModels = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return models.filter((model) =>
      normalizedSearch ? model.name.toLowerCase().includes(normalizedSearch) : true,
    );
  }, [models, search]);

  const installedModels = filteredModels
    .filter((model) => model.installed)
    .sort((a, b) => (a.name === configuredModel ? -1 : b.name === configuredModel ? 1 : 0));
  const availableModels = filteredModels.filter((model) => !model.installed);
  const availableTotalPages = Math.max(
    1,
    Math.ceil(availableModels.length / AVAILABLE_PAGE_SIZE),
  );
  const pagedAvailableModels = availableModels.slice(
    (availablePage - 1) * AVAILABLE_PAGE_SIZE,
    availablePage * AVAILABLE_PAGE_SIZE,
  );

  const selectedDownloadOption = useMemo(
    () =>
      models.find(
        (model) => model.name.toLowerCase() === downloadModel.trim().toLowerCase(),
      ) || null,
    [downloadModel, models],
  );

  const canDownload =
    Boolean(selectedDownloadOption) && !selectedDownloadOption?.installed && busy === "";

  const refreshRuntime = useCallback(async () => {
    const response = await fetch("/api/runtime", { cache: "no-store" });
    const data = (await response.json()) as RuntimeStatus & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Unable to refresh runtime");
    }
    setRuntime(data);
    return data;
  }, []);

  const refreshModels = useCallback(async (baseUrl: string) => {
    const response = await fetch(
      `/api/ollama/models?baseUrl=${encodeURIComponent(baseUrl)}`,
      { cache: "no-store" },
    );
    const data = (await response.json()) as {
      models?: OllamaModelOption[];
      installedCount?: number;
      libraryCount?: number;
      installedError?: string;
      libraryError?: string;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error || "Unable to refresh Ollama inventory");
    }
    setModels(data.models || []);
    setInventorySummary({
      installedCount: data.installedCount || 0,
      libraryCount: data.libraryCount || 0,
      installedError: data.installedError || "",
      libraryError: data.libraryError || "",
    });
  }, []);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncOnMount() {
      try {
        const nextRuntime = await refreshRuntime();
        if (!cancelled) {
          await refreshModels(nextRuntime.settings.modelBaseUrl);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to refresh Ollama inventory",
          );
        }
      }
    }

    void syncOnMount();

    return () => {
      cancelled = true;
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, [refreshModels, refreshRuntime]);

  useEffect(() => {
    setAvailablePage(1);
  }, [search, models]);

  useEffect(() => {
    if (availablePage > availableTotalPages) {
      setAvailablePage(availableTotalPages);
    }
  }, [availablePage, availableTotalPages]);

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
      const response = await fetch(`/api/ollama/install/${jobId}`, { cache: "no-store" });
      const data = (await response.json()) as {
        job?: OllamaInstallJob;
        error?: string;
      };
      if (!response.ok || !data.job) {
        throw new Error(data.error || "Unable to fetch install progress");
      }

      setInstallState(data.job);

      if (data.job.status === "pending" || data.job.status === "running") {
        scheduleInstallPoll(jobId);
        return;
      }

      pollTimerRef.current = null;
      await refreshModels(runtime.settings.modelBaseUrl);
      await refreshRuntime();

      if (data.job.status === "completed") {
        setMessage(`${data.job.model} downloaded from Ollama.`);
        setDownloadModel("");
        return;
      }

      setError(data.job.error || `${data.job.model} download failed.`);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to fetch install progress",
      );
    } finally {
      setBusy("");
    }
  }

  async function startDownload(modelName: string) {
    setBusy("download");
    setInstallPrompt(null);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/ollama/install", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          baseUrl: runtime.settings.modelBaseUrl,
        }),
      });
      const data = (await response.json()) as {
        job?: OllamaInstallJob;
        error?: string;
      };
      if (!response.ok || !data.job) {
        throw new Error(data.error || "Unable to start model download");
      }
      setInstallState(data.job);
      scheduleInstallPoll(data.job.id);
    } catch (requestError) {
      setBusy("");
      setError(
        requestError instanceof Error ? requestError.message : "Unable to start model download",
      );
    }
  }

  async function removeModel(modelName: string) {
    setBusy(`remove:${modelName}`);
    setRemovePrompt(null);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/ollama/remove", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          baseUrl: runtime.settings.modelBaseUrl,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to remove model");
      }
      await refreshModels(runtime.settings.modelBaseUrl);
      await refreshRuntime();
      setMessage(`${modelName} removed from local Ollama storage.`);
      if (downloadModel === modelName) {
        setDownloadModel("");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to remove model");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="stack-lg">
      <ul className="metric-list compact-metrics subtle-panel">
        <li>
          <span>Model</span>
          <strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {configuredModel}
            <span
              className="status-dot"
              title={modelIsLive ? "live" : "offline"}
              style={modelIsLive ? { background: "var(--success)", boxShadow: "0 0 10px rgba(132,215,153,0.45)" } : undefined}
            />
          </strong>
        </li>
        <li>
          <span>Installed Locally</span>
          <strong>{inventorySummary.installedCount}</strong>
        </li>
        <li>
          <span>Available To Download</span>
          <strong>{inventorySummary.libraryCount}</strong>
        </li>
      </ul>

      {(message || error) ? (
        <div className="inline-actions">
          {message ? <p className="success-text">{message}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      ) : null}

      <div className="grid two-up">
        <div className="detail-block">
          <div className="detail-block-header">
            <div>
              <h3>Download Model</h3>
              <p className="helper-text">
                Pick any known Ollama model, then download it locally for the daemon and lab to use.
              </p>
            </div>
          </div>
          <div className="stack-sm">
            <ModelPicker
              mode="single"
              label="Model"
              value={downloadModel}
              options={models}
              onValueChange={(value) => setDownloadModel(value)}
              onSelect={(value) => setDownloadModel(value)}
              placeholder="Select or type an Ollama model"
              helperText={
                inventorySummary.installedError || inventorySummary.libraryError
                  ? [inventorySummary.installedError, inventorySummary.libraryError]
                      .filter(Boolean)
                      .join(" ")
                  : "Installed models are ready immediately. Available models can be downloaded here."
              }
            />
            <div className="inline-actions">
              <button
                type="button"
                disabled={!canDownload}
                onClick={() => {
                  if (selectedDownloadOption?.name) {
                    setInstallPrompt(selectedDownloadOption.name);
                  }
                }}
              >
                Download
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={busy !== ""}
                onClick={() => void refreshModels(runtime.settings.modelBaseUrl)}
              >
                Refresh Inventory
              </button>
            </div>
          </div>
        </div>

        <div className="detail-block">
          <div className="detail-block-header">
            <div>
              <h3>Catalog Filter</h3>
              <p className="helper-text">
                Filter installed and library models together. The configured daemon model is always highlighted.
              </p>
            </div>
          </div>
          <label>
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="qwen, llama, phi..."
            />
          </label>
        </div>
      </div>

      <div className="grid two-up">
        <div className="detail-block">
          <div className="detail-block-header">
            <div>
              <h3>Installed Locally</h3>
              <p className="helper-text">
                Remove models you no longer need. The configured daemon model cannot be removed from here.
              </p>
            </div>
          </div>
          <div className="model-catalog-list">
            {installedModels.length > 0 ? (
              installedModels.map((model) => {
                const isConfigured = model.name === configuredModel;
                const isLive = modelIsLive && model.name === configuredModel;
                return (
                  <div key={model.name} className="model-catalog-item">
                    <div className="model-catalog-item-header">
                      <code>{model.name}</code>
                      <div className="model-catalog-badges">
                        <span className="model-status-chip model-status-chip-installed">installed</span>
                        {isConfigured ? (
                          <span className="status-pill status-pill-running">configured</span>
                        ) : null}
                        {isLive ? <span className="status-pill status-pill-completed">live</span> : null}
                      </div>
                    </div>
                    <div className="model-catalog-item-actions">
                      <button
                        type="button"
                        className="button-danger"
                        disabled={busy !== "" || isConfigured}
                        onClick={() => setRemovePrompt(model.name)}
                      >
                        Remove
                      </button>
                      {isConfigured ? (
                        <span className="helper-text">Change the daemon setting before removing.</span>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="muted-text">No installed models match the current filter.</p>
            )}
          </div>
        </div>

        <div className="detail-block">
          <div className="detail-block-header">
            <div>
              <h3>Available From Ollama</h3>
              <p className="helper-text">
                Browse matching library models and download them without leaving the console.
              </p>
            </div>
            {hydrated && availableModels.length > 0 ? (
              <div className="pagination-controls">
                <span className="helper-text">
                  Page {availablePage} of {availableTotalPages}
                </span>
                <button
                  type="button"
                  className={availablePage <= 1 ? "pager-link disabled" : "pager-link"}
                  disabled={availablePage <= 1}
                  onClick={() => setAvailablePage((current) => Math.max(1, current - 1))}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className={
                    availablePage >= availableTotalPages ? "pager-link disabled" : "pager-link"
                  }
                  disabled={availablePage >= availableTotalPages}
                  onClick={() =>
                    setAvailablePage((current) =>
                      Math.min(availableTotalPages, current + 1),
                    )
                  }
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
          <div className="model-catalog-list">
            {availableModels.length > 0 ? (
              pagedAvailableModels.map((model) => {
                const isConfigured = model.name === configuredModel;
                return (
                  <div key={model.name} className="model-catalog-item">
                    <div className="model-catalog-item-header">
                      <code>{model.name}</code>
                      <div className="model-catalog-badges">
                        <span className="model-status-chip model-status-chip-available">available</span>
                        {isConfigured ? (
                          <span className="status-pill status-pill-running">configured</span>
                        ) : null}
                      </div>
                    </div>
                    {model.capabilities && model.capabilities.length > 0 ? (
                      <div className="model-catalog-capabilities">
                        {model.capabilities.map((capability) => (
                          <span key={`${model.name}-${capability}`} className="model-capability-chip">
                            {capability}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="model-catalog-item-actions">
                      <button
                        type="button"
                        disabled={busy !== ""}
                        onClick={() => setInstallPrompt(model.name)}
                      >
                        <Download aria-hidden="true" />
                        Download
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="muted-text">No downloadable models match the current filter.</p>
            )}
          </div>
          {hydrated && availableModels.length > 0 ? (
            <div className="pagination-controls">
              <button
                type="button"
                className={availablePage <= 1 ? "pager-link disabled" : "pager-link"}
                disabled={availablePage <= 1}
                onClick={() => setAvailablePage((current) => Math.max(1, current - 1))}
              >
                Prev
              </button>
              <span className="helper-text">
                Showing {(availablePage - 1) * AVAILABLE_PAGE_SIZE + 1}-
                {Math.min(availablePage * AVAILABLE_PAGE_SIZE, availableModels.length)} of{" "}
                {availableModels.length}
              </span>
              <button
                type="button"
                className={
                  availablePage >= availableTotalPages ? "pager-link disabled" : "pager-link"
                }
                disabled={availablePage >= availableTotalPages}
                onClick={() =>
                  setAvailablePage((current) =>
                    Math.min(availableTotalPages, current + 1),
                  )
                }
              >
                Next
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="toast-stack" aria-live="polite">
        {installPrompt ? (
          <div className="toast toast-warning" role="status">
            <div className="toast-title">Download {installPrompt}?</div>
            <p className="toast-body">
              This model will be pulled into your local Ollama store.
            </p>
            <div className="toast-actions">
              <button type="button" onClick={() => void startDownload(installPrompt)}>
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

        {removePrompt ? (
          <div className="toast toast-error" role="status">
            <div className="toast-title">Remove {removePrompt}?</div>
            <p className="toast-body">
              This removes the downloaded model from local Ollama storage.
            </p>
            <div className="toast-actions">
              <button
                type="button"
                className="button-danger"
                onClick={() => void removeModel(removePrompt)}
              >
                Remove Model
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setRemovePrompt(null)}
              >
                Keep installed
              </button>
            </div>
          </div>
        ) : null}

        {installState ? (
          <div
            className={
              installState.status === "failed"
                ? "toast toast-error"
                : installState.status === "completed"
                  ? "toast toast-success"
                  : "toast"
            }
            role="status"
          >
            <div className="toast-title">
              {installState.status === "completed"
                ? `${installState.model} ready`
                : installState.status === "failed"
                  ? `${installState.model} failed`
                  : `Downloading ${installState.model}`}
            </div>
            <p className="toast-body">{installState.error || installState.message}</p>
            <div className="toast-progress">
              <div
                className="toast-progress-fill"
                style={{ width: `${Math.max(6, installState.progressPercent)}%` }}
              />
            </div>
            <div className="toast-footer">
              <span>
                {installState.status === "completed" ? "100%" : `${installState.progressPercent}%`}
              </span>
              {installState.status === "completed" || installState.status === "failed" ? (
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
