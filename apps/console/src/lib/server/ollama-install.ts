import "server-only";

import { randomUUID } from "node:crypto";

import type { OllamaInstallJob } from "@/lib/types";
import { removeOllamaModel } from "@/lib/server/ollama";

type InternalInstallJob = OllamaInstallJob & {
  baseUrl: string;
};

type PullEvent = {
  status?: string;
  total?: number;
  completed?: number;
  error?: string;
};

type InstallStore = {
  jobs: Map<string, InternalInstallJob>;
  runningByModel: Map<string, string>;
  controllers: Map<string, AbortController>;
};

const installStore = getInstallStore();

function getInstallStore(): InstallStore {
  const scoped = globalThis as typeof globalThis & {
    __lacOllamaInstallStore?: Partial<InstallStore>;
  };

  if (!scoped.__lacOllamaInstallStore) {
    scoped.__lacOllamaInstallStore = {
      jobs: new Map<string, InternalInstallJob>(),
      runningByModel: new Map<string, string>(),
      controllers: new Map<string, AbortController>(),
    };
  }

  if (!scoped.__lacOllamaInstallStore.jobs) {
    scoped.__lacOllamaInstallStore.jobs = new Map<string, InternalInstallJob>();
  }
  if (!scoped.__lacOllamaInstallStore.runningByModel) {
    scoped.__lacOllamaInstallStore.runningByModel = new Map<string, string>();
  }
  if (!scoped.__lacOllamaInstallStore.controllers) {
    scoped.__lacOllamaInstallStore.controllers = new Map<string, AbortController>();
  }

  return scoped.__lacOllamaInstallStore as InstallStore;
}

function isActiveJob(job: InternalInstallJob) {
  return job.status === "pending" || job.status === "running";
}

function modelKey(baseUrl: string, model: string) {
  return `${baseUrl}|${model}`;
}

function clearJobFromRunning(job: InternalInstallJob) {
  const key = modelKey(job.baseUrl, job.model);
  if (installStore.runningByModel.get(key) === job.id) {
    installStore.runningByModel.delete(key);
  }
}

function deleteJob(jobId: string) {
  const job = installStore.jobs.get(jobId);
  if (!job) {
    return false;
  }

  clearJobFromRunning(job);
  installStore.controllers.delete(jobId);
  installStore.jobs.delete(jobId);
  return true;
}

function pruneCompletedJobs(baseUrl?: string) {
  const normalizedBaseUrl = baseUrl?.trim().replace(/\/$/, "") || "";
  for (const job of installStore.jobs.values()) {
    if (job.status !== "completed") {
      continue;
    }
    if (normalizedBaseUrl && job.baseUrl !== normalizedBaseUrl) {
      continue;
    }
    deleteJob(job.id);
  }
}

function serializeJob(job: InternalInstallJob): OllamaInstallJob {
  return {
    id: job.id,
    model: job.model,
    action: job.action,
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

function updateProgress(job: InternalInstallJob, event: PullEvent) {
  if (typeof event.status === "string" && event.status.trim()) {
    job.message = event.status;
  }
  if (typeof event.error === "string" && event.error.trim()) {
    job.error = event.error;
  }
  if (typeof event.total === "number" && Number.isFinite(event.total)) {
    job.total = event.total;
  }
  if (typeof event.completed === "number" && Number.isFinite(event.completed)) {
    job.completed = event.completed;
  }
  if (job.total > 0) {
    job.progressPercent = Math.max(
      2,
      Math.min(100, Math.round((job.completed / job.total) * 100)),
    );
  }
  if (event.status?.toLowerCase() === "success") {
    job.progressPercent = 100;
  }
  job.updatedAtMs = Date.now();
}

async function runInstall(job: InternalInstallJob, controller: AbortController) {

  try {
    job.status = "running";
    job.message = "Starting download";
    job.updatedAtMs = Date.now();

    const response = await fetch(`${job.baseUrl.replace(/\/$/, "")}/api/pull`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: job.model,
        stream: true,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ollama pull request failed with ${response.status}`);
    }

    if (!response.body) {
      throw new Error("ollama pull response did not include a body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          updateProgress(job, JSON.parse(line) as PullEvent);
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    const finalChunk = buffer.trim();
    if (finalChunk) {
      updateProgress(job, JSON.parse(finalChunk) as PullEvent);
    }

    job.status = job.error ? "failed" : "completed";
    job.message = job.error ? "Download failed" : "Download complete";
    job.progressPercent = job.error ? job.progressPercent : 100;
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      job.status = "cancelled";
      job.message = "Download cancelled";
      job.error = "";
    } else {
      job.status = "failed";
      job.message = "Download failed";
      job.error = error instanceof Error ? error.message : "ollama pull failed";
    }
  } finally {
    job.updatedAtMs = Date.now();
    job.finishedAtMs = Date.now();
    clearJobFromRunning(job);
    installStore.controllers.delete(job.id);
  }
}

async function runRemove(job: InternalInstallJob, controller: AbortController) {

  try {
    job.status = "running";
    job.message = "Removing model";
    job.progressPercent = 10;
    job.updatedAtMs = Date.now();

    await removeOllamaModel(job.baseUrl, job.model, controller.signal);

    job.status = "completed";
    job.message = "Removal complete";
    job.progressPercent = 100;
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      job.status = "cancelled";
      job.message = "Removal cancelled";
      job.error = "";
    } else {
      job.status = "failed";
      job.message = "Removal failed";
      job.error = error instanceof Error ? error.message : "ollama remove failed";
    }
  } finally {
    job.updatedAtMs = Date.now();
    job.finishedAtMs = Date.now();
    clearJobFromRunning(job);
    installStore.controllers.delete(job.id);
  }
}

export function getOllamaInstallJob(jobId: string) {
  const job = installStore.jobs.get(jobId);
  return job ? serializeJob(job) : null;
}

export function listOllamaInstallJobs(baseUrl?: string) {
  pruneCompletedJobs(baseUrl);
  const normalizedBaseUrl = baseUrl?.trim().replace(/\/$/, "") || "";
  return Array.from(installStore.jobs.values())
    .filter((job) => (normalizedBaseUrl ? job.baseUrl === normalizedBaseUrl : true))
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .map((job) => serializeJob(job));
}

function createJob(action: "install" | "remove", model: string, baseUrl: string) {
  const normalizedModel = model.trim();
  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, "");
  const nextModelKey = modelKey(normalizedBaseUrl, normalizedModel);
  const runningJobId = installStore.runningByModel.get(nextModelKey);
  if (runningJobId) {
    const existingJob = installStore.jobs.get(runningJobId);
    if (existingJob && isActiveJob(existingJob)) {
      return { job: existingJob, created: false };
    }
    installStore.runningByModel.delete(nextModelKey);
  }

  const now = Date.now();
  const job: InternalInstallJob = {
    id: randomUUID(),
    model: normalizedModel,
    action,
    baseUrl: normalizedBaseUrl,
    status: "pending",
    message: action === "install" ? "Queued download" : "Queued removal",
    progressPercent: 0,
    completed: 0,
    total: 0,
    error: "",
    startedAtMs: now,
    updatedAtMs: now,
    finishedAtMs: 0,
  };

  installStore.jobs.set(job.id, job);
  installStore.runningByModel.set(nextModelKey, job.id);
  return { job, created: true };
}

export function startOllamaInstall(model: string, baseUrl: string) {
  const { job, created } = createJob("install", model, baseUrl);
  if (created) {
    const controller = new AbortController();
    installStore.controllers.set(job.id, controller);
    void runInstall(job, controller);
  }

  return serializeJob(job);
}

export function startOllamaRemove(model: string, baseUrl: string) {
  const { job, created } = createJob("remove", model, baseUrl);
  if (created) {
    const controller = new AbortController();
    installStore.controllers.set(job.id, controller);
    void runRemove(job, controller);
  }

  return serializeJob(job);
}

export function cancelOllamaInstallJob(jobId: string) {
  const job = installStore.jobs.get(jobId);
  if (!job) {
    return null;
  }

  if (!isActiveJob(job)) {
    return serializeJob(job);
  }

  job.status = "cancelled";
  job.message = job.action === "install" ? "Download cancelled" : "Removal cancelled";
  job.error = "";
  job.updatedAtMs = Date.now();
  job.finishedAtMs = job.updatedAtMs;
  clearJobFromRunning(job);
  installStore.controllers.get(job.id)?.abort();
  return serializeJob(job);
}

export function dismissOllamaInstallJob(jobId: string) {
  const job = installStore.jobs.get(jobId);
  if (!job || isActiveJob(job)) {
    return false;
  }

  return deleteJob(jobId);
}
