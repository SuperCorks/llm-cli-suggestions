"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  initialRemoteLibraryCount: number;
  initialInstalledError?: string;
  initialLibraryError?: string;
}

function isActiveOperation(status: OllamaInstallJob["status"]) {
  return status === "pending" || status === "running";
}

function operationTitle(job: OllamaInstallJob) {
  return `${job.action === "install" ? "Download" : "Removal"} ${job.model}`;
}

function operationStatusClass(job: OllamaInstallJob) {
  if (job.status === "failed" || job.status === "cancelled") {
    return "status-pill status-pill-warning";
  }
  if (job.status === "completed") {
    return "status-pill status-pill-completed";
  }
  return "status-pill status-pill-running";
}

export function ModelsConsole({
  initialRuntime,
  initialModels,
  initialInstalledCount,
  initialLibraryCount,
  initialRemoteLibraryCount,
  initialInstalledError = "",
  initialLibraryError = "",
}: ModelsConsoleProps) {
  const AVAILABLE_PAGE_SIZE = 24;
  const [runtime, setRuntime] = useState(initialRuntime);
  const [models, setModels] = useState(initialModels);
  const [inventorySummary, setInventorySummary] = useState({
    installedCount: initialInstalledCount,
    libraryCount: initialLibraryCount,
    remoteLibraryCount: initialRemoteLibraryCount,
    installedError: initialInstalledError,
    libraryError: initialLibraryError,
  });
  const [downloadModel, setDownloadModel] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [operationJobs, setOperationJobs] = useState<OllamaInstallJob[]>([]);
  const [availablePage, setAvailablePage] = useState(1);
  const [hydrated, setHydrated] = useState(false);

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

  const activeOperationByModel = useMemo(() => {
    const byModel = new Map<string, OllamaInstallJob>();
    for (const job of operationJobs) {
      if (!isActiveOperation(job.status) || byModel.has(job.model)) {
        continue;
      }
      byModel.set(job.model, job);
    }
    return byModel;
  }, [operationJobs]);

  const activeOperations = useMemo(
    () => operationJobs.filter((job) => isActiveOperation(job.status)),
    [operationJobs],
  );

  const recentOperations = useMemo(
    () => operationJobs.filter((job) => !isActiveOperation(job.status)).slice(0, 6),
    [operationJobs],
  );

  const canDownload =
    Boolean(selectedDownloadOption) &&
    !selectedDownloadOption?.installed &&
    !selectedDownloadOption?.remoteOnly &&
    !activeOperationByModel.has(selectedDownloadOption?.name || "");

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
      remoteLibraryCount?: number;
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
      remoteLibraryCount: data.remoteLibraryCount || 0,
      installedError: data.installedError || "",
      libraryError: data.libraryError || "",
    });
  }, []);

  const refreshOperations = useCallback(async (baseUrl: string) => {
    const response = await fetch(
      `/api/ollama/operations?baseUrl=${encodeURIComponent(baseUrl)}`,
      { cache: "no-store" },
    );
    const data = (await response.json()) as {
      jobs?: OllamaInstallJob[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error || "Unable to refresh model operations");
    }
    setOperationJobs(data.jobs || []);
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
          await Promise.all([
            refreshModels(nextRuntime.settings.modelBaseUrl),
            refreshOperations(nextRuntime.settings.modelBaseUrl),
          ]);
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
    };
  }, [refreshModels, refreshOperations, refreshRuntime]);

  useEffect(() => {
    setAvailablePage(1);
  }, [search, models]);

  useEffect(() => {
    if (availablePage > availableTotalPages) {
      setAvailablePage(availableTotalPages);
    }
  }, [availablePage, availableTotalPages]);

  useEffect(() => {
    if (activeOperations.length === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      void Promise.all([
        refreshOperations(runtime.settings.modelBaseUrl),
        refreshModels(runtime.settings.modelBaseUrl),
      ]).catch((requestError) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to refresh model operations",
        );
      });
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeOperations.length, refreshModels, refreshOperations, runtime.settings.modelBaseUrl]);

  async function startDownload(modelName: string) {
    setError("");
    try {
      const model = models.find((candidate) => candidate.name === modelName) || null;
      if (model?.remoteOnly) {
        throw new Error("Cloud and remote-only Ollama models cannot be downloaded locally.");
      }

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

      await Promise.all([
        refreshOperations(runtime.settings.modelBaseUrl),
        refreshModels(runtime.settings.modelBaseUrl),
      ]);
      setDownloadModel("");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to start model download",
      );
    }
  }

  async function removeModel(modelName: string) {
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
      const data = (await response.json()) as { job?: OllamaInstallJob; error?: string };
      if (!response.ok || !data.job) {
        throw new Error(data.error || "Unable to remove model");
      }

      await Promise.all([
        refreshOperations(runtime.settings.modelBaseUrl),
        refreshModels(runtime.settings.modelBaseUrl),
      ]);
      if (downloadModel === modelName) {
        setDownloadModel("");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to remove model");
    }
  }

  async function updateOperation(jobId: string, action: "cancel" | "dismiss") {
    setError("");
    try {
      const response = await fetch("/api/ollama/operations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jobId,
          action,
          baseUrl: runtime.settings.modelBaseUrl,
        }),
      });
      const data = (await response.json()) as {
        jobs?: OllamaInstallJob[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || `Unable to ${action} model operation`);
      }

      setOperationJobs(data.jobs || []);
      await refreshModels(runtime.settings.modelBaseUrl);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : `Unable to ${action} model operation`,
      );
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
        <li>
          <span>Remote / Cloud Only</span>
          <strong>{inventorySummary.remoteLibraryCount}</strong>
        </li>
      </ul>

      {error ? <p className="error-text">{error}</p> : null}

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
                selectedDownloadOption?.remoteOnly
                  ? "Cloud and remote-only models stay visible in the catalog but cannot be downloaded into local Ollama storage."
                  : activeOperationByModel.has(selectedDownloadOption?.name || "")
                    ? activeOperationByModel.get(selectedDownloadOption?.name || "")?.message || "Operation in progress."
                  : inventorySummary.installedError || inventorySummary.libraryError
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
                    void startDownload(selectedDownloadOption.name);
                  }
                }}
              >
                Download
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() =>
                  void Promise.all([
                    refreshModels(runtime.settings.modelBaseUrl),
                    refreshOperations(runtime.settings.modelBaseUrl),
                  ])
                }
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
          <div className="model-operations-panel">
            <div className="detail-block-header model-operations-header">
              <div>
                <h4>Model Operations</h4>
                <p className="helper-text">
                  Downloads and removals continue here across page refreshes while the console server stays running.
                </p>
              </div>
            </div>
            {operationJobs.length > 0 ? (
              <div className="model-operation-list">
                {[...activeOperations, ...recentOperations].map((job) => (
                  <div key={job.id} className="model-operation-item">
                    <div className="model-operation-head">
                      <strong>{operationTitle(job)}</strong>
                      <span className={operationStatusClass(job)}>
                        {job.status}
                      </span>
                    </div>
                    <p
                      className={
                        job.status === "failed" ? "error-text" : "helper-text"
                      }
                    >
                      {job.error || job.message}
                    </p>
                    <div className="toast-progress model-operation-progress">
                      <div
                        className="toast-progress-fill"
                        style={{ width: `${Math.max(6, job.progressPercent)}%` }}
                      />
                    </div>
                    <div className="model-operation-meta">
                      <span>{job.progressPercent}%</span>
                      <span>{job.model}</span>
                    </div>
                    <div className="model-operation-actions">
                      {isActiveOperation(job.status) ? (
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => void updateOperation(job.id, "cancel")}
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => void updateOperation(job.id, "dismiss")}
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="helper-text">No model downloads or removals need attention.</p>
            )}
          </div>
          <div className="model-catalog-list">
            {installedModels.length > 0 ? (
              installedModels.map((model) => {
                const isConfigured = model.name === configuredModel;
                const isLive = modelIsLive && model.name === configuredModel;
                const activeJob = activeOperationByModel.get(model.name) || null;
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
                        disabled={Boolean(activeJob) || isConfigured}
                        onClick={() => void removeModel(model.name)}
                      >
                        {activeJob?.action === "remove" ? "Removing" : "Remove"}
                      </button>
                      {isConfigured ? (
                        <span className="helper-text">
                          {hydrated ? (
                            <>
                              Change the <Link href="/daemon">daemon settings</Link> before removing.
                            </>
                          ) : (
                            "Change the daemon settings before removing."
                          )}
                        </span>
                      ) : activeJob ? (
                        <span className="helper-text">{activeJob.message}</span>
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
                const isRemoteOnly = Boolean(model.remoteOnly);
                const activeJob = activeOperationByModel.get(model.name) || null;
                return (
                  <div
                    key={model.name}
                    className={
                      isRemoteOnly
                        ? "model-catalog-item model-catalog-item-remote"
                        : "model-catalog-item"
                    }
                  >
                    <div className="model-catalog-item-header">
                      <code>{model.name}</code>
                      <div className="model-catalog-badges">
                        <span
                          className={
                            isRemoteOnly
                              ? "model-status-chip model-status-chip-remote"
                              : "model-status-chip model-status-chip-available"
                          }
                        >
                          {isRemoteOnly ? "remote" : "available"}
                        </span>
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
                        disabled={Boolean(activeJob) || isRemoteOnly}
                        onClick={() => {
                          if (!isRemoteOnly && !activeJob) {
                            void startDownload(model.name);
                          }
                        }}
                      >
                        <Download aria-hidden="true" />
                        {isRemoteOnly
                          ? "Remote Only"
                          : activeJob?.action === "install"
                            ? "Downloading"
                            : "Download"}
                      </button>
                      {isRemoteOnly ? (
                        <span className="helper-text">
                          Remote/cloud model. Visible for reference, but local installation is disabled.
                        </span>
                      ) : activeJob ? (
                        <span className="helper-text">{activeJob.message}</span>
                      ) : null}
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

    </div>
  );
}
