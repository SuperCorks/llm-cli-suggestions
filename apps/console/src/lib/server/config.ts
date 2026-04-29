import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_SYSTEM_PROMPT_STATIC } from "@/lib/default-system-prompt";
import { normalizePtyCaptureList } from "@/lib/pty-capture-list";
import { normalizeSuggestStrategy } from "@/lib/suggest-strategy";
import type { AcceptSuggestionKey, PtyCaptureMode, RuntimeSettings } from "@/lib/types";

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
  LAC_FAST_MODEL_NAME: "",
  LAC_MODEL_BASE_URL: "http://127.0.0.1:11434",
  LAC_MODEL_KEEP_ALIVE: "5m",
  LAC_MODEL_RETRY_ENABLED: "true",
  LAC_SUGGEST_STRATEGY: "history+model",
  LAC_SYSTEM_PROMPT_STATIC: DEFAULT_SYSTEM_PROMPT_STATIC,
  LAC_SUGGEST_TIMEOUT_MS: "1200",
  LAC_ACCEPT_KEY: "tab",
  LAC_PTY_CAPTURE_MODE: "blocklist",
  LAC_PTY_CAPTURE_ALLOWLIST: "",
  LAC_PTY_CAPTURE_BLOCKLIST: "",
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

export function normalizePtyCaptureMode(value: string | undefined): PtyCaptureMode {
  return value?.trim().toLowerCase() === "allowlist" ? "allowlist" : "blocklist";
}

export function normalizeAcceptSuggestionKey(value: string | undefined): AcceptSuggestionKey {
  return value?.trim().toLowerCase() === "right-arrow" ? "right-arrow" : "tab";
}

export function normalizeBooleanSetting(value: string | undefined, fallback = false) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

export function normalizePtyCaptureCommandList(value: string | undefined) {
  return normalizePtyCaptureList(value);
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
  const lines = fs.readFileSync(runtimeEnvPath, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.startsWith("$'")) {
      while (findClosingQuoteIndex(value, "'", 2) === -1 && index + 1 < lines.length) {
        index += 1;
        value += `\n${lines[index]}`;
      }
    } else if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      while (findClosingQuoteIndex(value, quote, 1) === -1 && index + 1 < lines.length) {
        index += 1;
        value += `\n${lines[index]}`;
      }
    }

    values[key] = decodePersistedValue(value);
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
    fastModelName: runtimeValue("LAC_FAST_MODEL_NAME") || DEFAULTS.LAC_FAST_MODEL_NAME,
    modelBaseUrl: runtimeValue("LAC_MODEL_BASE_URL") || DEFAULTS.LAC_MODEL_BASE_URL,
    modelKeepAlive:
      runtimeValue("LAC_MODEL_KEEP_ALIVE") || DEFAULTS.LAC_MODEL_KEEP_ALIVE,
    modelRetryEnabled: normalizeBooleanSetting(
      runtimeValue("LAC_MODEL_RETRY_ENABLED") || DEFAULTS.LAC_MODEL_RETRY_ENABLED,
      true,
    ),
    suggestStrategy: normalizeSuggestStrategy(
      runtimeValue("LAC_SUGGEST_STRATEGY") || DEFAULTS.LAC_SUGGEST_STRATEGY,
    ),
    systemPromptStatic:
      runtimeValue("LAC_SYSTEM_PROMPT_STATIC") || DEFAULTS.LAC_SYSTEM_PROMPT_STATIC,
    suggestTimeoutMs: Number.parseInt(
      runtimeValue("LAC_SUGGEST_TIMEOUT_MS") || DEFAULTS.LAC_SUGGEST_TIMEOUT_MS,
      10,
    ),
    acceptKey: normalizeAcceptSuggestionKey(
      runtimeValue("LAC_ACCEPT_KEY") || DEFAULTS.LAC_ACCEPT_KEY,
    ),
    ptyCaptureMode: normalizePtyCaptureMode(
      runtimeValue("LAC_PTY_CAPTURE_MODE") || DEFAULTS.LAC_PTY_CAPTURE_MODE,
    ),
    ptyCaptureAllowlist:
      normalizePtyCaptureCommandList(
        runtimeValue("LAC_PTY_CAPTURE_ALLOWLIST") || DEFAULTS.LAC_PTY_CAPTURE_ALLOWLIST,
      ),
    ptyCaptureBlocklist:
      normalizePtyCaptureCommandList(
        runtimeValue("LAC_PTY_CAPTURE_BLOCKLIST") || DEFAULTS.LAC_PTY_CAPTURE_BLOCKLIST,
      ),
  };
}

const SAVED_KEYS = [
  "LAC_MODEL_NAME",
  "LAC_FAST_MODEL_NAME",
  "LAC_MODEL_BASE_URL",
  "LAC_MODEL_KEEP_ALIVE",
  "LAC_MODEL_RETRY_ENABLED",
  "LAC_SUGGEST_STRATEGY",
  "LAC_SYSTEM_PROMPT_STATIC",
  "LAC_SOCKET_PATH",
  "LAC_DB_PATH",
  "LAC_SUGGEST_TIMEOUT_MS",
  "LAC_ACCEPT_KEY",
  "LAC_PTY_CAPTURE_MODE",
  "LAC_PTY_CAPTURE_ALLOWLIST",
  "LAC_PTY_CAPTURE_BLOCKLIST",
] as const;

export type PersistedKey = (typeof SAVED_KEYS)[number];

function shellQuote(value: string) {
  return `$'${encodeAnsiCString(value)}'`;
}

export function writePersistedRuntimeSettings(values: Partial<Record<PersistedKey, string>>) {
  ensureStateDirs();
  const lines = SAVED_KEYS.map((key) => `${key}=${shellQuote(values[key] || "")}`);
  fs.writeFileSync(getRuntimeEnvPath(), `${lines.join("\n")}\n`, "utf8");
}

function findClosingQuoteIndex(value: string, quote: string, startIndex: number) {
  let escaped = false;
  for (let index = startIndex; index < value.length; index += 1) {
    const current = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (current === "\\") {
      escaped = true;
      continue;
    }
    if (current === quote) {
      return index;
    }
  }
  return -1;
}

function decodePersistedValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("$'") && trimmed.endsWith("'")) {
    return decodeAnsiCString(trimmed.slice(2, -1));
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return decodeDoubleQuotedValue(trimmed.slice(1, -1));
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function decodeAnsiCString(value: string) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    if (current !== "\\") {
      result += current;
      continue;
    }

    const next = value[index + 1];
    if (next === undefined) {
      result += "\\";
      continue;
    }

    index += 1;
    switch (next) {
      case "n":
        result += "\n";
        break;
      case "r":
        result += "\r";
        break;
      case "t":
        result += "\t";
        break;
      case "\\":
        result += "\\";
        break;
      case "'":
        result += "'";
        break;
      case '"':
        result += '"';
        break;
      default:
        result += next;
        break;
    }
  }
  return result;
}

function decodeDoubleQuotedValue(value: string) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    if (current !== "\\") {
      result += current;
      continue;
    }

    const next = value[index + 1];
    if (next === undefined) {
      result += "\\";
      continue;
    }

    index += 1;
    switch (next) {
      case "n":
        result += "\n";
        break;
      case "r":
        result += "\r";
        break;
      case "t":
        result += "\t";
        break;
      case "\\":
        result += "\\";
        break;
      case '"':
        result += '"';
        break;
      case "'":
        result += "'";
        break;
      default:
        result += next;
        break;
    }
  }
  return result;
}

function encodeAnsiCString(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
}
