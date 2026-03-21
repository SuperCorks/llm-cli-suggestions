import "server-only";

import { randomUUID } from "node:crypto";

import type { OllamaInstallJob } from "@/lib/types";

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
};

const installStore = getInstallStore();

function getInstallStore(): InstallStore {
  const scoped = globalThis as typeof globalThis & {
    __lacOllamaInstallStore?: InstallStore;
  };

  if (!scoped.__lacOllamaInstallStore) {
    scoped.__lacOllamaInstallStore = {
      jobs: new Map<string, InternalInstallJob>(),
      runningByModel: new Map<string, string>(),
    };
  }

  return scoped.__lacOllamaInstallStore;
}

function serializeJob(job: InternalInstallJob): OllamaInstallJob {
  return {
    id: job.id,
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

async function runInstall(job: InternalInstallJob) {
  const modelKey = `${job.baseUrl}|${job.model}`;

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
    job.status = "failed";
    job.message = "Download failed";
    job.error = error instanceof Error ? error.message : "ollama pull failed";
  } finally {
    job.updatedAtMs = Date.now();
    job.finishedAtMs = Date.now();
    installStore.runningByModel.delete(modelKey);
  }
}

export function getOllamaInstallJob(jobId: string) {
  const job = installStore.jobs.get(jobId);
  return job ? serializeJob(job) : null;
}

export function startOllamaInstall(model: string, baseUrl: string) {
  const normalizedModel = model.trim();
  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, "");
  const modelKey = `${normalizedBaseUrl}|${normalizedModel}`;
  const runningJobId = installStore.runningByModel.get(modelKey);
  if (runningJobId) {
    const existingJob = installStore.jobs.get(runningJobId);
    if (existingJob) {
      return serializeJob(existingJob);
    }
  }

  const now = Date.now();
  const job: InternalInstallJob = {
    id: randomUUID(),
    model: normalizedModel,
    baseUrl: normalizedBaseUrl,
    status: "pending",
    message: "Queued download",
    progressPercent: 0,
    completed: 0,
    total: 0,
    error: "",
    startedAtMs: now,
    updatedAtMs: now,
    finishedAtMs: 0,
  };

  installStore.jobs.set(job.id, job);
  installStore.runningByModel.set(modelKey, job.id);
  void runInstall(job);

  return serializeJob(job);
}
