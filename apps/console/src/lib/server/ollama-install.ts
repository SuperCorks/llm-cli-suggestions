import "server-only";

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import type { OllamaInstallJob } from "@/lib/types";
import { removeOllamaModel } from "@/lib/server/ollama";
import { restartDaemon } from "@/lib/server/runtime";

type InternalInstallJob = OllamaInstallJob & {
  baseUrl: string;
};

type InstallAction = OllamaInstallJob["action"];

type PullEvent = {
  status?: string;
  total?: number;
  completed?: number;
  error?: string;
};

type HomebrewInstallKind = "formula" | "cask";

type InstallStore = {
  jobs: Map<string, InternalInstallJob>;
  runningByModel: Map<string, string>;
  controllers: Map<string, AbortController>;
};

const OLLAMA_UPDATE_JOB_MODEL = "Ollama";
const OLLAMA_VERSION_POLL_TIMEOUT_MS = 25_000;
const OLLAMA_VERSION_POLL_INTERVAL_MS = 500;

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

function queuedMessage(action: InstallAction) {
  if (action === "install") {
    return "Queued download";
  }
  if (action === "remove") {
    return "Queued removal";
  }
  return "Queued Ollama update";
}

function cancelledMessage(action: InstallAction) {
  if (action === "install") {
    return "Download cancelled";
  }
  if (action === "remove") {
    return "Removal cancelled";
  }
  return "Ollama update cancelled";
}

function completedMessage(action: InstallAction) {
  if (action === "install") {
    return "Download complete";
  }
  if (action === "remove") {
    return "Removal complete";
  }
  return "Ollama updated and daemons restarted";
}

function formatCommandOutput(stdout: string, stderr: string) {
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return combined.slice(0, 1_200);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

async function runCommand(
  command: string,
  args: string[],
  controller: AbortController,
  options?: { env?: NodeJS.ProcessEnv },
) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      env: options?.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const abortHandler = () => {
      child.kill("SIGTERM");
      reject(new DOMException("Command aborted", "AbortError"));
    };

    controller.signal.addEventListener("abort", abortHandler, { once: true });

    child.on("error", (error) => {
      controller.signal.removeEventListener("abort", abortHandler);
      reject(error);
    });

    child.on("exit", (code, signal) => {
      controller.signal.removeEventListener("abort", abortHandler);
      if (controller.signal.aborted) {
        reject(new DOMException("Command aborted", "AbortError"));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const detail = formatCommandOutput(stdout, stderr);
      reject(
        new Error(
          detail
            ? `${command} ${args.join(" ")} failed with ${signal || code}: ${detail}`
            : `${command} ${args.join(" ")} failed with ${signal || code}`,
        ),
      );
    });
  });
}

async function detectHomebrewInstallKind(controller: AbortController): Promise<HomebrewInstallKind> {
  try {
    await runCommand("brew", ["list", "--versions", "ollama"], controller);
    return "formula";
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      throw error;
    }
  }

  await runCommand("brew", ["list", "--cask", "--versions", "ollama"], controller);
  return "cask";
}

function isLocalOllamaBaseUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function waitForOllamaVersionEndpoint(baseUrl: string, controller: AbortController) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < OLLAMA_VERSION_POLL_TIMEOUT_MS) {
    if (controller.signal.aborted) {
      throw new DOMException("Command aborted", "AbortError");
    }

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/version`, {
        cache: "no-store",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(2_000),
        ]),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling while the local service restarts.
    }

    await new Promise((resolve) => setTimeout(resolve, OLLAMA_VERSION_POLL_INTERVAL_MS));
  }

  throw new Error(`Ollama did not become ready at ${baseUrl} after the update.`);
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
      const bodyText = await response.text();
      let errorMessage = bodyText.trim();

      if (errorMessage) {
        try {
          const parsed = JSON.parse(errorMessage) as { error?: string };
          errorMessage = parsed.error?.trim() || errorMessage;
        } catch {
          // Keep the raw response body when Ollama returns plain text.
        }
      }

      throw new Error(
        errorMessage
          ? `ollama pull request failed with ${response.status}: ${errorMessage}`
          : `ollama pull request failed with ${response.status}`,
      );
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
    if (controller.signal.aborted || isAbortError(error)) {
      job.status = "cancelled";
      job.message = cancelledMessage(job.action);
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
    job.message = completedMessage(job.action);
    job.progressPercent = 100;
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      job.status = "cancelled";
      job.message = cancelledMessage(job.action);
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

async function runUpdate(job: InternalInstallJob, controller: AbortController) {
  try {
    if (!isLocalOllamaBaseUrl(job.baseUrl)) {
      throw new Error(
        "Automatic updates only work when the console points at a local Ollama instance.",
      );
    }

    job.status = "running";
    job.message = "Checking Homebrew-managed Ollama installation";
    job.progressPercent = 5;
    job.updatedAtMs = Date.now();

    const installKind = await detectHomebrewInstallKind(controller);
    const upgradeArgs =
      installKind === "formula"
        ? ["upgrade", "ollama"]
        : ["upgrade", "--cask", "ollama"];

    job.message = "Updating Ollama with Homebrew";
    job.progressPercent = 18;
    job.updatedAtMs = Date.now();
    await runCommand("brew", upgradeArgs, controller);

    job.message = "Restarting Ollama service";
    job.progressPercent = 72;
    job.updatedAtMs = Date.now();
    await runCommand("brew", ["services", "restart", "ollama"], controller);

    job.message = "Waiting for Ollama to come back online";
    job.progressPercent = 84;
    job.updatedAtMs = Date.now();
    await waitForOllamaVersionEndpoint(job.baseUrl, controller);

    job.message = "Restarting autocomplete daemon";
    job.progressPercent = 94;
    job.updatedAtMs = Date.now();
    await restartDaemon();

    job.status = "completed";
    job.message = completedMessage(job.action);
    job.progressPercent = 100;
    job.error = "";
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      job.status = "cancelled";
      job.message = cancelledMessage(job.action);
      job.error = "";
    } else {
      job.status = "failed";
      job.message = "Ollama update failed";
      job.error =
        error instanceof Error ? error.message : "Unable to update Ollama";
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
    .sort((left, right) => {
      const leftActive = isActiveJob(left);
      const rightActive = isActiveJob(right);
      if (leftActive !== rightActive) {
        return leftActive ? -1 : 1;
      }

      if (leftActive && rightActive) {
        return (
          left.startedAtMs - right.startedAtMs ||
          left.model.localeCompare(right.model) ||
          left.id.localeCompare(right.id)
        );
      }

      const leftFinishedAt = left.finishedAtMs || left.updatedAtMs;
      const rightFinishedAt = right.finishedAtMs || right.updatedAtMs;
      return (
        rightFinishedAt - leftFinishedAt ||
        left.model.localeCompare(right.model) ||
        left.id.localeCompare(right.id)
      );
    })
    .map((job) => serializeJob(job));
}

function createJob(action: InstallAction, model: string, baseUrl: string) {
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
    message: queuedMessage(action),
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

export function startOllamaUpdate(baseUrl: string) {
  const { job, created } = createJob("update", OLLAMA_UPDATE_JOB_MODEL, baseUrl);
  if (created) {
    const controller = new AbortController();
    installStore.controllers.set(job.id, controller);
    void runUpdate(job, controller);
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
  job.message = cancelledMessage(job.action);
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
