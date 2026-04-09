import "server-only";

import { spawnSync } from "node:child_process";

import type { OllamaUpdateStatus } from "@/lib/types";

type BrewFormulaInfo = {
  versions?: {
    stable?: string;
  };
  installed?: Array<{
    version?: string;
  }>;
  linked_keg?: string;
  outdated?: boolean;
};

type BrewCaskInfo = {
  version?: string;
  installed?: string | string[];
  outdated?: boolean;
};

type BrewInfoResponse = {
  formulae?: BrewFormulaInfo[];
  casks?: BrewCaskInfo[];
};

function isLocalOllamaBaseUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function trimVersion(value: string | undefined) {
  return value?.trim() || "";
}

function parseInstalledCaskVersion(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return trimVersion(value[0]);
  }
  return trimVersion(value);
}

export function getOllamaUpdateStatus(baseUrl: string): OllamaUpdateStatus {
  if (!isLocalOllamaBaseUrl(baseUrl)) {
    return {
      supported: false,
      outdated: false,
      installKind: null,
      installedVersion: "",
      latestVersion: "",
    };
  }

  const result = spawnSync("brew", ["info", "--json=v2", "ollama"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return {
      supported: false,
      outdated: false,
      installKind: null,
      installedVersion: "",
      latestVersion: "",
      error: result.stderr.trim() || result.stdout.trim() || "Unable to inspect Homebrew Ollama info.",
    };
  }

  try {
    const parsed = JSON.parse(result.stdout) as BrewInfoResponse;
    const formula = parsed.formulae?.[0];
    if (formula && (formula.installed?.length || formula.linked_keg)) {
      return {
        supported: true,
        outdated: Boolean(formula.outdated),
        installKind: "formula",
        installedVersion:
          trimVersion(formula.linked_keg) ||
          trimVersion(formula.installed?.[0]?.version),
        latestVersion: trimVersion(formula.versions?.stable),
      };
    }

    const cask = parsed.casks?.[0];
    if (cask && parseInstalledCaskVersion(cask.installed)) {
      return {
        supported: true,
        outdated: Boolean(cask.outdated),
        installKind: "cask",
        installedVersion: parseInstalledCaskVersion(cask.installed),
        latestVersion: trimVersion(cask.version),
      };
    }

    return {
      supported: false,
      outdated: false,
      installKind: null,
      installedVersion: "",
      latestVersion: "",
    };
  } catch (error) {
    return {
      supported: false,
      outdated: false,
      installKind: null,
      installedVersion: "",
      latestVersion: "",
      error: error instanceof Error ? error.message : "Unable to parse Homebrew Ollama info.",
    };
  }
}
