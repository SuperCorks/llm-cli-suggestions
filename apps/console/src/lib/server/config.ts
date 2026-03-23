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
  "llm-cli-suggestions",
);

const DEFAULTS = {
  LAC_SOCKET_PATH: "daemon.sock",
  LAC_DB_PATH: "autocomplete.sqlite",
  LAC_MODEL_NAME: "qwen2.5-coder:7b",
  LAC_MODEL_BASE_URL: "http://127.0.0.1:11434",
  LAC_MODEL_KEEP_ALIVE: "5m",
  LAC_SUGGEST_STRATEGY: "history+model",
  LAC_SYSTEM_PROMPT_STATIC: "",
  LAC_SUGGEST_TIMEOUT_MS: "1200",
  LAC_PTY_CAPTURE_ALLOWLIST: "",
} as const;

const PROCESS_ENV_OVERRIDE_FLAG = "LAC_CONSOLE_USE_PROCESS_ENV_OVERRIDES";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(CONFIG_DIR, "../../../../../");

interface RuntimeSettingsResolveOptions {
  useProcessEnvOverrides?: boolean;
}

export function getProjectRoot() {
  return PROJECT_ROOT;
}

function shouldUseProcessEnvOverrides() {
  const value = (process.env[PROCESS_ENV_OVERRIDE_FLAG] || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function getStateDir(options?: RuntimeSettingsResolveOptions) {
  const useProcessEnvOverrides = options?.useProcessEnvOverrides ?? shouldUseProcessEnvOverrides();
  return (useProcessEnvOverrides ? process.env.LAC_STATE_DIR : undefined) || DEFAULT_STATE_DIR;
}

export function getRuntimeEnvPath(options?: RuntimeSettingsResolveOptions) {
  return path.join(getStateDir(options), "runtime.env");
}

export function getDaemonLogPath(options?: RuntimeSettingsResolveOptions) {
  return path.join(getStateDir(options), "daemon.log");
}

export function getDaemonPidPath(options?: RuntimeSettingsResolveOptions) {
  return path.join(getStateDir(options), "daemon.pid");
}

export function getBenchOutputDir(options?: RuntimeSettingsResolveOptions) {
  return path.join(getStateDir(options), "benchmarks");
}

export function ensureStateDirs(options?: RuntimeSettingsResolveOptions) {
  fs.mkdirSync(getStateDir(options), { recursive: true });
  fs.mkdirSync(getBenchOutputDir(options), { recursive: true });
}

export function readPersistedRuntimeSettings(options?: RuntimeSettingsResolveOptions) {
  const runtimeEnvPath = getRuntimeEnvPath(options);
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

export function getResolvedRuntimeSettings(options?: RuntimeSettingsResolveOptions): RuntimeSettings {
  const useProcessEnvOverrides = options?.useProcessEnvOverrides ?? shouldUseProcessEnvOverrides();
  const persisted = readPersistedRuntimeSettings({ useProcessEnvOverrides });
  const stateDir = getStateDir({ useProcessEnvOverrides });
  const runtimeEnvPath = getRuntimeEnvPath({ useProcessEnvOverrides });
  const runtimeValue = (key: keyof typeof DEFAULTS) =>
    (useProcessEnvOverrides ? process.env[key] : undefined) || persisted[key];

  return {
    stateDir,
    runtimeEnvPath,
    socketPath: runtimeValue("LAC_SOCKET_PATH") || path.join(stateDir, DEFAULTS.LAC_SOCKET_PATH),
    dbPath: runtimeValue("LAC_DB_PATH") || path.join(stateDir, DEFAULTS.LAC_DB_PATH),
    modelName: runtimeValue("LAC_MODEL_NAME") || DEFAULTS.LAC_MODEL_NAME,
    modelBaseUrl: runtimeValue("LAC_MODEL_BASE_URL") || DEFAULTS.LAC_MODEL_BASE_URL,
    modelKeepAlive:
      runtimeValue("LAC_MODEL_KEEP_ALIVE") || DEFAULTS.LAC_MODEL_KEEP_ALIVE,
    suggestStrategy: normalizeSuggestStrategy(
      runtimeValue("LAC_SUGGEST_STRATEGY") || DEFAULTS.LAC_SUGGEST_STRATEGY,
    ),
    systemPromptStatic:
      runtimeValue("LAC_SYSTEM_PROMPT_STATIC") || DEFAULTS.LAC_SYSTEM_PROMPT_STATIC,
    suggestTimeoutMs: Number.parseInt(
      runtimeValue("LAC_SUGGEST_TIMEOUT_MS") || DEFAULTS.LAC_SUGGEST_TIMEOUT_MS,
      10,
    ),
    ptyCaptureAllowlist:
      runtimeValue("LAC_PTY_CAPTURE_ALLOWLIST") || DEFAULTS.LAC_PTY_CAPTURE_ALLOWLIST,
  };
}

const SAVED_KEYS = [
  "LAC_MODEL_NAME",
  "LAC_MODEL_BASE_URL",
  "LAC_MODEL_KEEP_ALIVE",
  "LAC_SUGGEST_STRATEGY",
  "LAC_SYSTEM_PROMPT_STATIC",
  "LAC_SOCKET_PATH",
  "LAC_DB_PATH",
  "LAC_SUGGEST_TIMEOUT_MS",
  "LAC_PTY_CAPTURE_ALLOWLIST",
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
