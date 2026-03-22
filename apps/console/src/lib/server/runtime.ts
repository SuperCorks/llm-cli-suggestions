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

export async function getRuntimeStatusWithHealth() {
  return hydrateHealth(getRuntimeStatus());
}

export async function saveRuntimeSettings(input: Partial<Record<PersistedKey, string>>) {
  const current = getResolvedRuntimeSettings();
  writePersistedRuntimeSettings({
    LAC_MODEL_NAME: input.LAC_MODEL_NAME || current.modelName,
    LAC_MODEL_BASE_URL: input.LAC_MODEL_BASE_URL || current.modelBaseUrl,
    LAC_SUGGEST_STRATEGY: input.LAC_SUGGEST_STRATEGY || current.suggestStrategy,
    LAC_SOCKET_PATH: input.LAC_SOCKET_PATH || current.socketPath,
    LAC_DB_PATH: input.LAC_DB_PATH || current.dbPath,
    LAC_SUGGEST_TIMEOUT_MS:
      input.LAC_SUGGEST_TIMEOUT_MS || String(current.suggestTimeoutMs),
    LAC_PTY_CAPTURE_ALLOWLIST:
      input.LAC_PTY_CAPTURE_ALLOWLIST ?? current.ptyCaptureAllowlist,
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
  const result = spawnSync("pgrep", ["-f", `autocomplete-daemon.*${socketPath}`], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return [] as number[];
  }
  return result.stdout
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));
}

export async function startDaemon() {
  ensureStateDirs();
  const current = await getRuntimeStatusWithHealth();
  if (current.health.ok) {
    return current;
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
        LAC_MODEL_BASE_URL: settings.modelBaseUrl,
        LAC_SUGGEST_STRATEGY: settings.suggestStrategy,
        LAC_SUGGEST_TIMEOUT_MS: String(settings.suggestTimeoutMs),
        LAC_PTY_CAPTURE_ALLOWLIST: settings.ptyCaptureAllowlist,
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

  for (const candidate of pidCandidates) {
    try {
      process.kill(candidate, "SIGTERM");
    } catch {
      // ignore stale pid
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 300));

  for (const candidate of pidCandidates) {
    try {
      process.kill(candidate, 0);
      process.kill(candidate, "SIGKILL");
    } catch {
      // process exited
    }
  }

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
