"use client";

import { ChevronDown, Download, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ModelMetadataChips } from "@/components/model-metadata-chips";
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
  const [sizeFilters, setSizeFilters] = useState<string[]>([]);
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [operationJobs, setOperationJobs] = useState<OllamaInstallJob[]>([]);
  const [availablePage, setAvailablePage] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [switchingModel, setSwitchingModel] = useState<string | null>(null);
  const sizeFilterRef = useRef<HTMLDivElement | null>(null);

  const configuredModel = runtime.settings.modelName;
  const modelIsLive = runtime.health.ok && runtime.health.modelName === configuredModel;

  const sizeOptions = useMemo(
    () =>
      [...new Set(models.map((model) => model.sizeLabel?.trim() || "").filter(Boolean))].sort(
        (left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
      ),
    [models],
  );

  const filteredAvailableModels = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return models.filter((model) => {
      if (model.installed) {
        return false;
      }
      const matchesSearch = normalizedSearch ? model.name.toLowerCase().includes(normalizedSearch) : true;
      const matchesSize =
        sizeFilters.length > 0 ? sizeFilters.includes(model.sizeLabel?.trim() || "") : true;
      return matchesSearch && matchesSize;
    });
  }, [models, search, sizeFilters]);

  const installedModels = models
    .filter((model) => model.installed)
    .sort((a, b) => (a.name === configuredModel ? -1 : b.name === configuredModel ? 1 : 0));
  const availableModels = filteredAvailableModels;
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
  }, [search, models, sizeFilters]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!sizeFilterRef.current?.contains(event.target as Node)) {
        setSizeMenuOpen(false);
      }
    }

    if (!sizeMenuOpen) {
      return;
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [sizeMenuOpen]);

  useEffect(() => {
    if (availablePage > availableTotalPages) {
      setAvailablePage(availableTotalPages);
    }
  }, [availablePage, availableTotalPages]);

  useEffect(() => {
    if (activeOperations.length === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
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
      window.clearInterval(intervalId);
    };
  }, [activeOperations.length, refreshModels, refreshOperations, runtime.settings.modelBaseUrl]);

  async function startDownload(modelName: string) {
    setMessage("");
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
    setMessage("");
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

  function toggleSizeFilter(size: string) {
    setSizeFilters((current) =>
      current.includes(size) ? current.filter((value) => value !== size) : [...current, size],
    );
  }

  const sizeFilterSummary =
    sizeFilters.length === 0
      ? "All sizes"
      : sizeFilters.length <= 2
        ? sizeFilters.join(", ")
        : `${sizeFilters.length} sizes`;

  async function activateModel(modelName: string) {
    setSwitchingModel(modelName);
    setMessage("");
    setError("");
    try {
      const settingsResponse = await fetch("/api/runtime/settings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          LAC_MODEL_NAME: modelName,
        }),
      });
      const settingsData = (await settingsResponse.json()) as { error?: string };
      if (!settingsResponse.ok) {
        throw new Error(settingsData.error || "Unable to save runtime settings");
      }

      const restartResponse = await fetch("/api/runtime/restart", {
        method: "POST",
      });
      const restartData = (await restartResponse.json()) as RuntimeStatus & { error?: string };
      if (!restartResponse.ok) {
        throw new Error(restartData.error || "Unable to restart daemon");
      }

      setRuntime(restartData);
      await refreshRuntime();
      setMessage(`${modelName} is now the active model.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to switch active model");
    } finally {
      setSwitchingModel(null);
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

      {message ? <p className="success-text">{message}</p> : null}
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
                Filter the downloadable Ollama catalog without hiding installed local models. The configured daemon model is always highlighted.
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
          <label>
            Size
            <div className="multi-select-filter" ref={sizeFilterRef}>
              <button
                type="button"
                className="multi-select-filter-trigger"
                aria-haspopup="listbox"
                aria-expanded={sizeMenuOpen}
                onClick={() => setSizeMenuOpen((current) => !current)}
                disabled={sizeOptions.length === 0}
              >
                <span>{sizeFilterSummary}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={sizeMenuOpen ? "multi-select-filter-icon multi-select-filter-icon-open" : "multi-select-filter-icon"}
                />
              </button>
              {sizeMenuOpen ? (
                <div className="multi-select-filter-menu" role="menu" aria-label="Size filters">
                  <div className="multi-select-filter-chip-grid">
                    <button
                      type="button"
                      className={sizeFilters.length === 0 ? "multi-select-filter-chip active" : "multi-select-filter-chip"}
                      onClick={() => setSizeFilters([])}
                      aria-pressed={sizeFilters.length === 0}
                    >
                      <span>All sizes</span>
                    </button>
                    {sizeOptions.map((size) => {
                      const selected = sizeFilters.includes(size);
                      return (
                        <button
                          key={size}
                          type="button"
                          className={selected ? "multi-select-filter-chip active" : "multi-select-filter-chip"}
                          onClick={() => toggleSizeFilter(size)}
                          aria-pressed={selected}
                        >
                          <span>{size}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {sizeOptions.length === 0 ? (
                <span className="helper-text">No size metadata available.</span>
              ) : null}
            </div>
          </label>
        </div>
      </div>

      <div className="grid two-up">
        <div className="detail-block">
          <div className="detail-block-header">
            <div>
              <h3>Installed Locally</h3>
              <p className="helper-text">
                Hover a row to quickly switch the daemon to another installed model or remove models you no longer need.
              </p>
            </div>
          </div>
          {operationJobs.length > 0 ? (
            <div className="model-operations-panel">
              <div className="detail-block-header model-operations-header">
                <div>
                  <h4>Model Operations</h4>
                  <p className="helper-text">
                    Downloads and removals continue here across page refreshes while the console server stays running.
                  </p>
                </div>
              </div>
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
            </div>
          ) : null}
          <div className="model-catalog-list">
            {installedModels.length > 0 ? (
              installedModels.map((model) => {
                const isConfigured = model.name === configuredModel;
                const isLive = modelIsLive && model.name === configuredModel;
                const activeJob = activeOperationByModel.get(model.name) || null;
                const canActivate = !isConfigured && !activeJob;
                return (
                  <div key={model.name} className="model-catalog-item">
                    <div className="model-catalog-row">
                      <div className="model-catalog-primary">
                        <code>{model.name}</code>
                        {isConfigured ? (
                          <span className="model-catalog-note">
                            {hydrated ? (
                              <>
                                Change the <Link href="/daemon">daemon settings</Link> before removing.
                              </>
                            ) : (
                              "Change the daemon settings before removing."
                            )}
                          </span>
                        ) : activeJob ? (
                          <span className="model-catalog-note">{activeJob.message}</span>
                        ) : null}
                      </div>
                      <div className="model-catalog-meta">
                        <div className="model-catalog-badges">
                          <ModelMetadataChips model={model} showInstalledStatus />
                          {isConfigured ? (
                            <span className="status-pill status-pill-running">configured</span>
                          ) : null}
                          {isLive ? <span className="status-pill status-pill-completed">live</span> : null}
                        </div>
                      </div>
                      <div className="model-catalog-actions-inline">
                        {canActivate ? (
                          <button
                            type="button"
                            className="icon-button model-catalog-icon-button"
                            disabled={switchingModel !== null}
                            onClick={() => void activateModel(model.name)}
                            aria-label={switchingModel === model.name ? "Activating model" : "Use as active model"}
                            title={switchingModel === model.name ? `Activating ${model.name}` : `Use ${model.name} as the active model`}
                          >
                            <Play aria-hidden="true" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="icon-button model-catalog-icon-button model-catalog-icon-button-danger"
                          disabled={Boolean(activeJob) || isConfigured || switchingModel !== null}
                          onClick={() => void removeModel(model.name)}
                          aria-label={activeJob?.action === "remove" ? "Removing" : "Remove"}
                          title={activeJob?.action === "remove" ? `Removing ${model.name}` : `Remove ${model.name}`}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="muted-text">No installed models found.</p>
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
                    <div className="model-catalog-row">
                      <div className="model-catalog-primary">
                        <code>{model.name}</code>
                        {isRemoteOnly ? (
                          <span className="model-catalog-note">
                            Remote/cloud model. Visible for reference, but local installation is disabled.
                          </span>
                        ) : activeJob ? (
                          <span className="model-catalog-note">{activeJob.message}</span>
                        ) : null}
                      </div>
                      <div className="model-catalog-meta">
                        <div className="model-catalog-badges">
                          <ModelMetadataChips model={model} showRemoteStatus />
                          {isConfigured ? (
                            <span className="status-pill status-pill-running">configured</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="model-catalog-actions-inline">
                        <button
                          type="button"
                          className="icon-button model-catalog-icon-button"
                          disabled={Boolean(activeJob) || isRemoteOnly}
                          onClick={() => {
                            if (!isRemoteOnly && !activeJob) {
                              void startDownload(model.name);
                            }
                          }}
                          aria-label={
                            isRemoteOnly
                              ? "Remote only"
                              : activeJob?.action === "install"
                                ? "Downloading"
                                : "Download"
                          }
                          title={
                            isRemoteOnly
                              ? `Remote only model ${model.name}`
                              : activeJob?.action === "install"
                                ? `Downloading ${model.name}`
                                : `Download ${model.name}`
                          }
                        >
                          <Download aria-hidden="true" />
                        </button>
                      </div>
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
