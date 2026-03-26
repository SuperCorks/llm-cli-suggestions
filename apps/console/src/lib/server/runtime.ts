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
import { getLoadedOllamaModelUsage } from "@/lib/server/ollama";
import type { RuntimeStatus } from "@/lib/types";

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
    },
  } satisfies RuntimeStatus;
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
  const activeModelName = status.health.modelName || status.settings.modelName;
  const modelUsage = await getLoadedOllamaModelUsage(
    status.settings.modelBaseUrl,
    activeModelName,
  );
  const daemonRssBytes = status.memory.daemonRssBytes;
  const totalTrackedBytes =
    daemonRssBytes !== null
      ? daemonRssBytes + (modelUsage.modelLoadedBytes || 0)
      : modelUsage.modelLoadedBytes;

  status.memory = {
    daemonRssBytes,
    modelLoadedBytes: modelUsage.modelLoadedBytes,
    modelVramBytes: modelUsage.modelVramBytes,
    totalTrackedBytes,
    modelName: modelUsage.modelName,
  };
  return status;
}

export async function getRuntimeStatusWithHealth() {
  const status = await hydrateHealth(getRuntimeStatus());
  return hydrateMemory(status);
}

export async function saveRuntimeSettings(input: Partial<Record<PersistedKey, string>>) {
  const current = getResolvedRuntimeSettings();
  writePersistedRuntimeSettings({
    LAC_MODEL_NAME: input.LAC_MODEL_NAME || current.modelName,
    LAC_FAST_MODEL_NAME: input.LAC_FAST_MODEL_NAME ?? current.fastModelName,
    LAC_MODEL_BASE_URL: input.LAC_MODEL_BASE_URL || current.modelBaseUrl,
    LAC_MODEL_KEEP_ALIVE: input.LAC_MODEL_KEEP_ALIVE || current.modelKeepAlive,
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
  });
  return getResolvedRuntimeSettings();
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
