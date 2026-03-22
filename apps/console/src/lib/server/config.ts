import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeSuggestStrategy } from "@/lib/suggest-strategy";
import type { RuntimeSettings } from "@/lib/types";

const DEFAULT_STATE_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "cli-auto-complete",
);

const DEFAULTS = {
  LAC_SOCKET_PATH: "daemon.sock",
  LAC_DB_PATH: "autocomplete.sqlite",
  LAC_MODEL_NAME: "qwen2.5-coder:7b",
  LAC_MODEL_BASE_URL: "http://127.0.0.1:11434",
  LAC_SUGGEST_STRATEGY: "history+model",
  LAC_SUGGEST_TIMEOUT_MS: "1200",
} as const;

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(CONFIG_DIR, "../../../../../");

export function getProjectRoot() {
  return PROJECT_ROOT;
}

export function getStateDir() {
  return process.env.LAC_STATE_DIR || DEFAULT_STATE_DIR;
}

export function getRuntimeEnvPath() {
  return path.join(getStateDir(), "runtime.env");
}

export function getDaemonLogPath() {
  return path.join(getStateDir(), "daemon.log");
}

export function getDaemonPidPath() {
  return path.join(getStateDir(), "daemon.pid");
}

export function getBenchOutputDir() {
  return path.join(getStateDir(), "benchmarks");
}

export function ensureStateDirs() {
  fs.mkdirSync(getStateDir(), { recursive: true });
  fs.mkdirSync(getBenchOutputDir(), { recursive: true });
}

export function readPersistedRuntimeSettings() {
  const runtimeEnvPath = getRuntimeEnvPath();
  if (!fs.existsSync(runtimeEnvPath)) {
    return {} as Record<string, string>;
  }

  const values: Record<string, string> = {};
  const contents = fs.readFileSync(runtimeEnvPath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

export function getResolvedRuntimeSettings(options?: { useProcessEnvOverrides?: boolean }): RuntimeSettings {
  const useProcessEnvOverrides = options?.useProcessEnvOverrides ?? false;
  const persisted = readPersistedRuntimeSettings();
  const stateDir = getStateDir();
  const runtimeEnvPath = getRuntimeEnvPath();
  const runtimeValue = (key: keyof typeof DEFAULTS) =>
    (useProcessEnvOverrides ? process.env[key] : undefined) || persisted[key];

  return {
    stateDir,
    runtimeEnvPath,
    socketPath: runtimeValue("LAC_SOCKET_PATH") || path.join(stateDir, DEFAULTS.LAC_SOCKET_PATH),
    dbPath: runtimeValue("LAC_DB_PATH") || path.join(stateDir, DEFAULTS.LAC_DB_PATH),
    modelName: runtimeValue("LAC_MODEL_NAME") || DEFAULTS.LAC_MODEL_NAME,
    modelBaseUrl: runtimeValue("LAC_MODEL_BASE_URL") || DEFAULTS.LAC_MODEL_BASE_URL,
    suggestStrategy: normalizeSuggestStrategy(
      runtimeValue("LAC_SUGGEST_STRATEGY") || DEFAULTS.LAC_SUGGEST_STRATEGY,
    ),
    suggestTimeoutMs: Number.parseInt(
      runtimeValue("LAC_SUGGEST_TIMEOUT_MS") || DEFAULTS.LAC_SUGGEST_TIMEOUT_MS,
      10,
    ),
  };
}

const SAVED_KEYS = [
  "LAC_MODEL_NAME",
  "LAC_MODEL_BASE_URL",
  "LAC_SUGGEST_STRATEGY",
  "LAC_SOCKET_PATH",
  "LAC_DB_PATH",
  "LAC_SUGGEST_TIMEOUT_MS",
] as const;

export type PersistedKey = (typeof SAVED_KEYS)[number];

function shellQuote(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function writePersistedRuntimeSettings(values: Partial<Record<PersistedKey, string>>) {
  ensureStateDirs();
  const lines = SAVED_KEYS.map((key) => `${key}=${shellQuote(values[key] || "")}`);
  fs.writeFileSync(getRuntimeEnvPath(), `${lines.join("\n")}\n`, "utf8");
}
