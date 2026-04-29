import "server-only";

import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

import { daemonRequest } from "@/lib/server/daemon";
import {
  ensureStateDirs,
  getDaemonLogPath,
  getDaemonPidPath,
  getProjectRoot,
  getResolvedRuntimeSettings,
  type PersistedKey,
  writePersistedRuntimeSettings,
} from "@/lib/server/config";
import { getLoadedOllamaModelUsages, unloadOllamaModel } from "@/lib/server/ollama";
import type { RuntimeStatus } from "@/lib/types";

type RuntimeModelSettingsLike = {
  modelName: string;
  fastModelName: string;
  suggestStrategy: string;
  modelBaseUrl: string;
};

function getDaemonBinaryPath() {
  return path.join(getProjectRoot(), "bin", "autocomplete-daemon");
}

export function getRuntimeStatus() {
  const settings = getResolvedRuntimeSettings();
  const pidPath = getDaemonPidPath();
  const logPath = getDaemonLogPath();
  const candidatePids = findDaemonPids(settings.socketPath);
  const pid = resolveDaemonPid(pidPath, candidatePids);
  const daemonRssBytes = readProcessRSSBytes(pid);

  return {
    settings,
    pidPath,
    logPath,
    pid,
    health: {
      ok: false,
      modelName: settings.modelName,
      socket: settings.socketPath,
    },
    memory: {
      daemonRssBytes,
      modelLoadedBytes: null,
      modelVramBytes: null,
      totalTrackedBytes: null,
      modelName: null,
      models: [],
    },
  } satisfies RuntimeStatus;
}

function normalizeRuntimeModelName(modelName: string) {
  const trimmed = modelName.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  return trimmed.endsWith(":latest") ? trimmed.slice(0, -7) : trimmed;
}

function configuredRuntimeModels(settings: RuntimeModelSettingsLike) {
  return [
    { modelName: settings.modelName, role: "primary" as const },
    ...(settings.fastModelName.trim() !== ""
      ? [{ modelName: settings.fastModelName, role: "fast" as const }]
      : []),
  ].filter(
    (entry, index, collection) =>
      entry.modelName.trim() !== "" &&
      collection.findIndex(
        (candidate) =>
          normalizeRuntimeModelName(candidate.modelName) ===
          normalizeRuntimeModelName(entry.modelName),
      ) === index,
  );
}

function requestedRuntimeModels(settings: RuntimeModelSettingsLike) {
  const dualModelMode =
    settings.fastModelName.trim() !== "" &&
    (settings.suggestStrategy === "history-then-fast-then-model" ||
      settings.suggestStrategy === "fast-then-model");

  if (!dualModelMode) {
    return configuredRuntimeModels({ ...settings, fastModelName: "" });
  }

  return configuredRuntimeModels(settings);
}

async function unloadReplacedRuntimeModels(
  previous: RuntimeModelSettingsLike,
  next: RuntimeModelSettingsLike,
) {
  const previousBaseUrl = previous.modelBaseUrl.trim();
  if (previousBaseUrl === "") {
    return;
  }

  const baseUrlChanged = previousBaseUrl !== next.modelBaseUrl.trim();
  const previousActiveKeys = new Set(
    requestedRuntimeModels(previous)
      .map((entry) => normalizeRuntimeModelName(entry.modelName))
      .filter(Boolean),
  );
  const nextActiveKeys = new Set(
    requestedRuntimeModels(next)
      .map((entry) => normalizeRuntimeModelName(entry.modelName))
      .filter(Boolean),
  );
  const nextConfiguredKeys = new Set(
    configuredRuntimeModels(next)
      .map((entry) => normalizeRuntimeModelName(entry.modelName))
      .filter(Boolean),
  );
  const nextKeys = new Set(
    [...nextConfiguredKeys, ...nextActiveKeys].filter(Boolean),
  );
  const previousModelsByKey = new Map<string, string>();

  for (const entry of configuredRuntimeModels(previous)) {
    const modelName = entry.modelName.trim();
    const key = normalizeRuntimeModelName(modelName);
    if (!key || previousModelsByKey.has(key)) {
      continue;
    }
    previousModelsByKey.set(key, modelName);
  }

  for (const entry of requestedRuntimeModels(previous)) {
    const modelName = entry.modelName.trim();
    const key = normalizeRuntimeModelName(modelName);
    if (!key || previousModelsByKey.has(key)) {
      continue;
    }
    previousModelsByKey.set(key, modelName);
  }

  for (const [key, modelName] of previousModelsByKey) {
    const droppedFromConfiguredRoles = !nextConfiguredKeys.has(key);
    const droppedFromActiveRoles = previousActiveKeys.has(key) && !nextActiveKeys.has(key);

    if (!baseUrlChanged && nextKeys.has(key) && !droppedFromConfiguredRoles && !droppedFromActiveRoles) {
      continue;
    }

    try {
      await unloadOllamaModel(previousBaseUrl, modelName);
    } catch (error) {
      console.warn(
        `best-effort ollama unload failed for ${modelName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function readPidFile(pidPath: string) {
  if (!fs.existsSync(pidPath)) {
    return null;
  }
  const raw = fs.readFileSync(pidPath, "utf8").trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isFinite(pid) ? pid : null;
}

function resolveDaemonPid(pidPath: string, candidatePids: number[]) {
  const pidFromFile = readPidFile(pidPath);
  if (pidFromFile && candidatePids.includes(pidFromFile)) {
    return pidFromFile;
  }
  if (candidatePids.length > 0) {
    return candidatePids[0];
  }
  return pidFromFile;
}

function listDaemonProcesses() {
  const result = spawnSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return [] as Array<{ pid: number; command: string }>;
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        return [];
      }

      const pid = Number.parseInt(match[1] || "", 10);
      const command = match[2] || "";
      if (!Number.isFinite(pid) || !command.includes("autocomplete-daemon")) {
        return [];
      }

      return [{ pid, command }];
    });
}

function readProcessRSSBytes(pid: number | null) {
  if (!pid) {
    return null;
  }

  const result = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }

  const rssKb = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isFinite(rssKb) || rssKb <= 0) {
    return null;
  }
  return rssKb * 1024;
}

async function hydrateHealth(status: RuntimeStatus) {
  try {
    const health = await daemonRequest<{ status: string; model_name: string; socket: string }>(
      status.settings,
      "/health",
    );
    status.health = {
      ok: health.status === "ok",
      modelName: health.model_name,
      socket: health.socket,
    };
  } catch (error) {
    status.health = {
      ok: false,
      modelName: status.settings.modelName,
      socket: status.settings.socketPath,
      error: error instanceof Error ? error.message : "health check failed",
    };
  }
  return status;
}

async function hydrateMemory(status: RuntimeStatus) {
  const requestedModels = requestedRuntimeModels(status.settings);
  const modelUsages = await getLoadedOllamaModelUsages(
    status.settings.modelBaseUrl,
    requestedModels.map((entry) => entry.modelName),
  );
  const daemonRssBytes = status.memory.daemonRssBytes;
  const runtimeModels = requestedModels.map((requestedModel, index) => ({
    modelName: modelUsages[index]?.modelName || requestedModel.modelName,
    role: requestedModel.role,
    modelLoadedBytes: modelUsages[index]?.modelLoadedBytes ?? null,
    modelVramBytes: modelUsages[index]?.modelVramBytes ?? null,
  }));
  const loadedModelBytes = runtimeModels.reduce(
    (sum, model) => sum + (model.modelLoadedBytes || 0),
    0,
  );
  const loadedModelVramBytes = runtimeModels.reduce(
    (sum, model) => sum + (model.modelVramBytes || 0),
    0,
  );
  const hasLoadedModel = runtimeModels.some((model) => model.modelLoadedBytes !== null);
  const totalTrackedBytes =
    daemonRssBytes !== null
      ? daemonRssBytes + loadedModelBytes
      : hasLoadedModel
        ? loadedModelBytes
        : null;

  status.memory = {
    daemonRssBytes,
    modelLoadedBytes: hasLoadedModel ? loadedModelBytes : null,
    modelVramBytes: hasLoadedModel ? loadedModelVramBytes : null,
    totalTrackedBytes,
    modelName: status.health.modelName || runtimeModels[0]?.modelName || status.settings.modelName,
    models: runtimeModels,
  };
  return status;
}

export async function getRuntimeStatusWithHealth() {
  const status = await hydrateHealth(getRuntimeStatus());
  return hydrateMemory(status);
}

export async function saveRuntimeSettings(input: Partial<Record<PersistedKey, string>>) {
  const current = getResolvedRuntimeSettings();
  const nextValues = {
    LAC_MODEL_NAME: input.LAC_MODEL_NAME || current.modelName,
    LAC_FAST_MODEL_NAME: input.LAC_FAST_MODEL_NAME ?? current.fastModelName,
    LAC_MODEL_BASE_URL: input.LAC_MODEL_BASE_URL || current.modelBaseUrl,
    LAC_MODEL_KEEP_ALIVE: input.LAC_MODEL_KEEP_ALIVE || current.modelKeepAlive,
    LAC_MODEL_RETRY_ENABLED:
      input.LAC_MODEL_RETRY_ENABLED ?? String(current.modelRetryEnabled),
    LAC_SUGGEST_STRATEGY: input.LAC_SUGGEST_STRATEGY || current.suggestStrategy,
    LAC_SYSTEM_PROMPT_STATIC:
      input.LAC_SYSTEM_PROMPT_STATIC ?? current.systemPromptStatic,
    LAC_SOCKET_PATH: input.LAC_SOCKET_PATH || current.socketPath,
    LAC_DB_PATH: input.LAC_DB_PATH || current.dbPath,
    LAC_SUGGEST_TIMEOUT_MS:
      input.LAC_SUGGEST_TIMEOUT_MS || String(current.suggestTimeoutMs),
    LAC_ACCEPT_KEY:
      input.LAC_ACCEPT_KEY ?? current.acceptKey,
    LAC_PTY_CAPTURE_MODE:
      input.LAC_PTY_CAPTURE_MODE ?? current.ptyCaptureMode,
    LAC_PTY_CAPTURE_ALLOWLIST:
      input.LAC_PTY_CAPTURE_ALLOWLIST ?? current.ptyCaptureAllowlist,
    LAC_PTY_CAPTURE_BLOCKLIST:
      input.LAC_PTY_CAPTURE_BLOCKLIST ?? current.ptyCaptureBlocklist,
  };

  writePersistedRuntimeSettings({
    ...nextValues,
  });

  const next = getResolvedRuntimeSettings();
  await unloadReplacedRuntimeModels(current, next);
  return next;
}

async function waitForHealth(attempts = 80, delayMs = 150) {
  const settings = getResolvedRuntimeSettings();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await daemonRequest(settings, "/health");
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

function findDaemonPids(socketPath: string) {
  return listDaemonProcesses()
    .filter((processInfo) => processInfo.command.includes(socketPath))
    .map((processInfo) => processInfo.pid);
}

function findAllDaemonPids() {
  return listDaemonProcesses().map((processInfo) => processInfo.pid);
}

async function stopDaemonPids(pidCandidates: Iterable<number>) {
  const uniquePids = Array.from(new Set(pidCandidates)).filter((value) => Number.isFinite(value));
  if (uniquePids.length === 0) {
    return;
  }

  for (const candidate of uniquePids) {
    try {
      process.kill(candidate, "SIGTERM");
    } catch {
      // ignore stale pid
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 300));

  for (const candidate of uniquePids) {
    try {
      process.kill(candidate, 0);
      process.kill(candidate, "SIGKILL");
    } catch {
      // process exited
    }
  }
}

export async function startDaemon() {
  ensureStateDirs();
  const current = await getRuntimeStatusWithHealth();
  const currentPids = findDaemonPids(current.settings.socketPath);
  const keepPid = current.health.ok ? resolveDaemonPid(getDaemonPidPath(), currentPids) : null;
  await stopDaemonPids(findAllDaemonPids().filter((pid) => pid !== keepPid));
  if (current.health.ok) {
    return getRuntimeStatusWithHealth();
  }

  const settings = current.settings;
  const logHandle = fs.openSync(getDaemonLogPath(), "a");
  const child = spawn(
    getDaemonBinaryPath(),
    [
      "--socket",
      settings.socketPath,
      "--db",
      settings.dbPath,
      "--model",
      settings.modelName,
      "--strategy",
      settings.suggestStrategy,
      "--model-url",
      settings.modelBaseUrl,
    ],
    {
      detached: true,
      stdio: ["ignore", logHandle, logHandle],
      env: {
        ...process.env,
        LAC_STATE_DIR: settings.stateDir,
        LAC_SOCKET_PATH: settings.socketPath,
        LAC_DB_PATH: settings.dbPath,
        LAC_MODEL_NAME: settings.modelName,
        LAC_FAST_MODEL_NAME: settings.fastModelName,
        LAC_MODEL_BASE_URL: settings.modelBaseUrl,
        LAC_MODEL_KEEP_ALIVE: settings.modelKeepAlive,
        LAC_SUGGEST_STRATEGY: settings.suggestStrategy,
        LAC_SYSTEM_PROMPT_STATIC: settings.systemPromptStatic,
        LAC_SUGGEST_TIMEOUT_MS: String(settings.suggestTimeoutMs),
        LAC_PTY_CAPTURE_MODE: settings.ptyCaptureMode,
        LAC_PTY_CAPTURE_ALLOWLIST: settings.ptyCaptureAllowlist,
        LAC_PTY_CAPTURE_BLOCKLIST: settings.ptyCaptureBlocklist,
      },
    },
  );
  child.unref();
  fs.writeFileSync(getDaemonPidPath(), `${child.pid}\n`, "utf8");

  const healthy = await waitForHealth();
  if (!healthy) {
    throw new Error(`daemon failed to become healthy on ${settings.socketPath}`);
  }
  return getRuntimeStatusWithHealth();
}

export async function stopDaemon() {
  const settings = getResolvedRuntimeSettings();
  const pidPath = getDaemonPidPath();
  const pidCandidates = new Set<number>();
  const pid = readPidFile(pidPath);
  if (pid) {
    pidCandidates.add(pid);
  }
  for (const candidate of findDaemonPids(settings.socketPath)) {
    pidCandidates.add(candidate);
  }

  for (const candidate of findAllDaemonPids()) {
    pidCandidates.add(candidate);
  }

  await stopDaemonPids(pidCandidates);

  if (fs.existsSync(pidPath)) {
    fs.rmSync(pidPath, { force: true });
  }

  return getRuntimeStatusWithHealth();
}

export async function restartDaemon() {
  await stopDaemon();
  return startDaemon();
}

export function tailDaemonLog(lines = 120) {
  const logPath = getDaemonLogPath();
  if (!fs.existsSync(logPath)) {
    return "";
  }
  return fs.readFileSync(logPath, "utf8").split(/\r?\n/).slice(-lines).join("\n");
}
