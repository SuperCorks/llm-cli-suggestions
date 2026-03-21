import "server-only";

import type { OllamaModelOption } from "@/lib/types";

type OllamaTagResponse = {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
};

function uniqueSortedModels(models: OllamaModelOption[]) {
  const deduped = new Map<string, OllamaModelOption>();
  for (const model of models) {
    const existing = deduped.get(model.name);
    if (!existing) {
      deduped.set(model.name, model);
      continue;
    }

    if (!existing.installed && model.installed) {
      deduped.set(model.name, model);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (left.installed !== right.installed) {
      return left.installed ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

async function fetchInstalledModels(baseUrl: string): Promise<OllamaModelOption[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
    signal: AbortSignal.timeout(2_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`ollama tags request failed with ${response.status}`);
  }

  const parsed = (await response.json()) as OllamaTagResponse;
  return (parsed.models || [])
    .map((model) => model.name || model.model || "")
    .filter(Boolean)
    .map((name) => ({
      name,
      installed: true,
      source: "installed" as const,
    }));
}

function parseLibraryModels(html: string): OllamaModelOption[] {
  const matches = html.matchAll(/href="\/library\/([a-z0-9][a-z0-9._-]*)"/gi);
  const models: OllamaModelOption[] = [];
  for (const match of matches) {
    const name = match[1];
    if (!name) {
      continue;
    }
    models.push({
      name,
      installed: false,
      source: "library",
    });
  }
  return models;
}

async function fetchLibraryModels(): Promise<OllamaModelOption[]> {
  const envModels = process.env.LAC_OLLAMA_LIBRARY_MODELS;
  if (envModels) {
    return envModels
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((name) => ({
        name,
        installed: false,
        source: "library" as const,
      }));
  }

  const response = await fetch("https://ollama.com/library", {
    signal: AbortSignal.timeout(4_000),
    next: { revalidate: 3600 },
  });
  if (!response.ok) {
    throw new Error(`ollama library request failed with ${response.status}`);
  }

  return parseLibraryModels(await response.text());
}

export async function listAvailableOllamaModels(baseUrl: string) {
  const [installedResult, libraryResult] = await Promise.allSettled([
    fetchInstalledModels(baseUrl),
    fetchLibraryModels(),
  ]);

  const installedModels = installedResult.status === "fulfilled" ? installedResult.value : [];
  const libraryModels = libraryResult.status === "fulfilled" ? libraryResult.value : [];

  return {
    models: uniqueSortedModels([...installedModels, ...libraryModels]),
    installedCount: installedModels.length,
    libraryCount: libraryModels.length,
    installedError:
      installedResult.status === "rejected" ? installedResult.reason instanceof Error ? installedResult.reason.message : "Unable to load local models" : "",
    libraryError:
      libraryResult.status === "rejected" ? libraryResult.reason instanceof Error ? libraryResult.reason.message : "Unable to load Ollama library models" : "",
  };
}
