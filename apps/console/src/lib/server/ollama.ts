import "server-only";

import type { OllamaModelOption } from "@/lib/types";

type OllamaTagResponse = {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
};

type OllamaShowResponse = {
  remote_model?: string | null;
  remote_host?: string | null;
  details?: {
    format?: string | null;
    family?: string | null;
    parameter_size?: string | null;
    quantization_level?: string | null;
  };
  model_info?: Record<string, string | number | boolean | null>;
};

type OllamaPsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
    size?: number;
    size_vram?: number;
  }>;
};

function normalizeModelName(name: string) {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  return trimmed.endsWith(":latest") ? trimmed.slice(0, -7) : trimmed;
}

const DEFAULT_SUPPLEMENTAL_LIBRARY_FAMILIES = [
  "gemma3",
  "qwen3-coder",
  "qwen3-coder-next",
];

function isRemoteOnlyModelName(name: string) {
	return name.endsWith(":cloud") || /-cloud$/i.test(name);
}

function localCapabilities(capabilities: string[]) {
	return capabilities.filter((capability) => capability !== "cloud");
}

function mergeCapabilities(left?: string[], right?: string[]) {
  const merged = Array.from(
    new Set([...(left || []), ...(right || [])].filter(Boolean)),
  );
  return merged.length > 0 ? merged : undefined;
}

function mergeModelOptions(
  existing: OllamaModelOption,
  incoming: OllamaModelOption,
): OllamaModelOption {
  const preferred =
    !existing.installed && incoming.installed
      ? incoming
      : existing.remoteOnly && !incoming.remoteOnly
        ? incoming
        : existing;
  const fallback = preferred === existing ? incoming : existing;
  const installed = existing.installed || incoming.installed;

  return {
    ...preferred,
    installed,
    source: installed ? "installed" : preferred.source,
    remoteOnly: installed ? false : Boolean(preferred.remoteOnly ?? fallback.remoteOnly),
    sizeLabel: preferred.sizeLabel || fallback.sizeLabel,
    contextWindowLabel:
      preferred.contextWindowLabel || fallback.contextWindowLabel,
    capabilities: mergeCapabilities(existing.capabilities, incoming.capabilities),
  };
}

function uniqueSortedModels(models: OllamaModelOption[]) {
  const deduped = new Map<string, OllamaModelOption>();
  for (const model of models) {
    const existing = deduped.get(model.name);
    if (!existing) {
      deduped.set(model.name, model);
      continue;
    }

    deduped.set(model.name, mergeModelOptions(existing, model));
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (left.installed !== right.installed) {
      return left.installed ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function normalizeSizeLabel(value?: string | null) {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    return "";
  }
  return trimmed;
}

function formatContextWindowValue(value: number) {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded) || rounded <= 0) {
    return "";
  }

  if (rounded >= 1024 && rounded % 1024 === 0) {
    return `${rounded / 1024}K`;
  }

  if (rounded >= 1000) {
    const thousands = rounded / 1000;
    const precision = thousands >= 10 ? 0 : 1;
    return `${thousands.toFixed(precision).replace(/\.0$/, "")}K`;
  }

  return `${rounded}`;
}

function normalizeContextWindowLabel(value?: string | number | null) {
  if (typeof value === "number") {
    return formatContextWindowValue(value);
  }

  const trimmed = value?.trim() || "";
  if (!trimmed) {
    return "";
  }

  const withoutSuffix = trimmed.replace(/\s+context window$/i, "").trim();
  const compactMatch = withoutSuffix.match(/^(\d+(?:\.\d+)?)\s*([km])$/i);
  if (compactMatch) {
    return `${compactMatch[1]}${compactMatch[2].toUpperCase()}`;
  }

  if (/^\d+(?:\.\d+)?$/.test(withoutSuffix)) {
    return formatContextWindowValue(Number(withoutSuffix));
  }

  return withoutSuffix.toUpperCase();
}

function extractContextWindowLabel(
  modelInfo?: Record<string, string | number | boolean | null>,
) {
  if (!modelInfo) {
    return "";
  }

  for (const [key, value] of Object.entries(modelInfo)) {
    if (!/(^|\.)context_length$/i.test(key)) {
      continue;
    }

    if (typeof value === "number") {
      return normalizeContextWindowLabel(value);
    }

    if (typeof value === "string") {
      return normalizeContextWindowLabel(value);
    }
  }

  return "";
}

function parseSupplementalVariantMetadata(html: string, rawName: string) {
  const href = `href="/library/${rawName}"`;
  const start = html.indexOf(href);
  if (start === -1) {
    return {
      sizeLabel: "",
      contextWindowLabel: "",
    };
  }

  const snippet = html.slice(start, start + 2_500);
  const columns = Array.from(
    snippet.matchAll(/<p class="col-span-2 text-neutral-500">([^<]+)<\/p>/gi),
  )
    .map((match) => match[1]?.trim() || "")
    .filter(Boolean);

  if (columns.length >= 2) {
    return {
      sizeLabel: normalizeSizeLabel(columns[0]),
      contextWindowLabel: normalizeContextWindowLabel(columns[1]),
    };
  }

  const compactSummary =
    snippet.match(/<p class="flex text-neutral-500">([^<]+)<\/p>/i)?.[1]?.trim() || "";
  const compactSegments = compactSummary
    .split(/\s*\u00b7\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const compactContext = compactSegments
    .find((segment) => /context window/i.test(segment))
    ?.replace(/\s+context window$/i, "")
    .trim();

  return {
    sizeLabel: normalizeSizeLabel(compactSegments[0]),
    contextWindowLabel: normalizeContextWindowLabel(compactContext),
  };
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
  const names = (parsed.models || [])
    .map((model) => model.name || model.model || "")
    .filter(Boolean);

  const inspectionResults = await Promise.all(
    names.map(async (name) => ({
      name,
      metadata: await inspectLocalModel(baseUrl, name),
    })),
  );

  return inspectionResults
    .filter((model) => !model.metadata.remoteReference)
    .map((model) => ({
      name: model.name,
      installed: true,
      source: "installed" as const,
      sizeLabel: model.metadata.sizeLabel,
      contextWindowLabel: model.metadata.contextWindowLabel,
    }));
}

function metadataScore(model: OllamaModelOption) {
  return (
    Number(Boolean(model.sizeLabel)) +
    Number(Boolean(model.contextWindowLabel)) +
    (model.capabilities?.length || 0)
  );
}

function enrichInstalledModelsFromLibrary(
  installedModels: OllamaModelOption[],
  libraryModels: OllamaModelOption[],
) {
  const bestLibraryByNormalizedName = new Map<string, OllamaModelOption>();

  for (const model of libraryModels) {
    if (model.remoteOnly) {
      continue;
    }

    const normalizedName = normalizeModelName(model.name);
    if (!normalizedName) {
      continue;
    }

    const existing = bestLibraryByNormalizedName.get(normalizedName);
    if (!existing || metadataScore(model) > metadataScore(existing)) {
      bestLibraryByNormalizedName.set(normalizedName, model);
    }
  }

  return installedModels.map((model) => {
    const matchedLibraryModel = bestLibraryByNormalizedName.get(
      normalizeModelName(model.name),
    );
    return matchedLibraryModel ? mergeModelOptions(model, matchedLibraryModel) : model;
  });
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/$/, "");
}

function parseLibraryModels(html: string): OllamaModelOption[] {
  const models: OllamaModelOption[] = [];
  const blocks = html.split(/<li\s+x-test-model\b/gi).slice(1);

  for (const block of blocks) {
    const hrefMatch = block.match(/href="\/library\/([a-z0-9][a-z0-9._:-]*)"/i);
    const name = hrefMatch?.[1];
    if (!name) {
      continue;
    }

    const capabilities = Array.from(
      block.matchAll(/<span[^>]*x-test-capability[^>]*>([^<]+)<\/span>/gi),
    )
      .map((match) => match[1]?.trim().toLowerCase() || "")
      .filter(Boolean);

    const sizes = Array.from(
      block.matchAll(/<span[^>]*x-test-size[^>]*>([^<]+)<\/span>/gi),
    )
      .map((match) => ({
        raw: normalizeSizeLabel(match[1]),
        normalized: match[1]?.trim().toLowerCase() || "",
      }))
      .filter((match) => Boolean(match.normalized));

    if (sizes.length > 0) {
      for (const size of sizes) {
        const remoteOnly = size.normalized === "cloud" || size.normalized.endsWith("-cloud");
        models.push({
          name: `${name}:${size.normalized}`,
          installed: false,
          source: "library",
          sizeLabel: remoteOnly ? "" : size.raw,
          capabilities: localCapabilities(capabilities),
          remoteOnly,
        });
      }
      continue;
    }

    const isCloudOnlyFamily =
      capabilities.includes("cloud") ||
      />\s*cloud\s*<\/span>/i.test(block) ||
      name.endsWith(":cloud");

    if (isCloudOnlyFamily) {
      models.push({
        name: `${name}:cloud`,
        installed: false,
        source: "library",
        capabilities: localCapabilities(capabilities),
        remoteOnly: true,
      });
      continue;
    }

    models.push({
      name,
      installed: false,
      source: "library",
      sizeLabel: "",
      capabilities: localCapabilities(capabilities),
      remoteOnly: false,
    });
  }
  return models;
}

function supplementalLibraryFamilies() {
  const configuredFamilies = process.env.LAC_OLLAMA_LIBRARY_FAMILY_PAGES;
  const families = configuredFamilies
    ? configuredFamilies
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : DEFAULT_SUPPLEMENTAL_LIBRARY_FAMILIES;

  return Array.from(new Set(families));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseSupplementalFamilyVariants(
  html: string,
  family: string,
  capabilities: string[],
): OllamaModelOption[] {
  const models: OllamaModelOption[] = [];
  const seen = new Set<string>();
  const escapedFamily = escapeRegExp(family);
  const tagPattern = new RegExp(
    `href="\\/library\\/(${escapedFamily}:[A-Za-z0-9][A-Za-z0-9._:-]*)"`,
    "g",
  );

  for (const match of html.matchAll(tagPattern)) {
    const rawName = match[1]?.trim();
    const name = rawName === `${family}:latest` ? family : rawName;
    if (!name || seen.has(name)) {
      continue;
    }

    const tag = rawName?.slice(family.length + 1) || "";
    const normalizedTag = tag.toLowerCase();
    if (!tag) {
      continue;
    }

    const metadata = parseSupplementalVariantMetadata(html, rawName);

    seen.add(name);
    models.push({
      name,
      installed: false,
      source: "library",
      sizeLabel: metadata.sizeLabel,
      contextWindowLabel: metadata.contextWindowLabel,
      capabilities: localCapabilities(capabilities),
      remoteOnly: normalizedTag.endsWith("-cloud") || normalizedTag === "cloud",
    });
  }

  return models;
}

async function fetchSupplementalFamilyVariants(
  family: string,
  capabilities: string[],
): Promise<OllamaModelOption[]> {
  const response = await fetch(`https://ollama.com/library/${family}`, {
    signal: AbortSignal.timeout(4_000),
    next: { revalidate: 3600 },
  });
  if (!response.ok) {
    throw new Error(`ollama family request failed with ${response.status}`);
  }

  return parseSupplementalFamilyVariants(await response.text(), family, capabilities);
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
        sizeLabel: "",
        capabilities: [],
        remoteOnly: isRemoteOnlyModelName(name),
      }));
  }

  const response = await fetch("https://ollama.com/library", {
    signal: AbortSignal.timeout(4_000),
    next: { revalidate: 3600 },
  });
  if (!response.ok) {
    throw new Error(`ollama library request failed with ${response.status}`);
  }

  const models = parseLibraryModels(await response.text());
  const capabilitiesByFamily = new Map<string, string[]>();
  for (const model of models) {
    const family = model.name.split(":", 1)[0];
    if (!family || capabilitiesByFamily.has(family)) {
      continue;
    }
    capabilitiesByFamily.set(family, model.capabilities || []);
  }

  try {
    const supplementalResults = await Promise.allSettled(
      supplementalLibraryFamilies().map((family) =>
        fetchSupplementalFamilyVariants(
          family,
          capabilitiesByFamily.get(family) || [],
        ),
      ),
    );

    const supplementalModels = supplementalResults.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );

    return uniqueSortedModels([...models, ...supplementalModels]);
  } catch {
    return models;
  }
}

async function inspectLocalModel(baseUrl: string, modelName: string) {
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/show`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: modelName,
      }),
      signal: AbortSignal.timeout(2_000),
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        remoteReference: false,
        sizeLabel: "",
        contextWindowLabel: "",
      };
    }

    const parsed = (await response.json()) as OllamaShowResponse;
    const hasRemoteRef = Boolean(parsed.remote_model || parsed.remote_host);
    const hasLocalDetails = Boolean(
      parsed.details?.format ||
        parsed.details?.family ||
        parsed.details?.parameter_size ||
        parsed.details?.quantization_level,
    );

    return {
      remoteReference: hasRemoteRef && !hasLocalDetails,
      sizeLabel: normalizeSizeLabel(parsed.details?.parameter_size),
      contextWindowLabel: extractContextWindowLabel(parsed.model_info),
    };
  } catch {
    return {
      remoteReference: false,
      sizeLabel: "",
      contextWindowLabel: "",
    };
  }
}

export async function listAvailableOllamaModels(baseUrl: string) {
  const [installedResult, libraryResult] = await Promise.allSettled([
    fetchInstalledModels(baseUrl),
    fetchLibraryModels(),
  ]);

  const installedModels = installedResult.status === "fulfilled" ? installedResult.value : [];
  const libraryModels = libraryResult.status === "fulfilled" ? libraryResult.value : [];
  const enrichedInstalledModels = enrichInstalledModelsFromLibrary(
    installedModels,
    libraryModels,
  );
  const downloadableLibraryModels = libraryModels.filter((model) => !model.remoteOnly);
  const remoteLibraryModels = libraryModels.filter((model) => model.remoteOnly);

  return {
    models: uniqueSortedModels([...enrichedInstalledModels, ...libraryModels]),
    installedCount: enrichedInstalledModels.length,
    libraryCount: downloadableLibraryModels.length,
    remoteLibraryCount: remoteLibraryModels.length,
    installedError:
      installedResult.status === "rejected" ? installedResult.reason instanceof Error ? installedResult.reason.message : "Unable to load local models" : "",
    libraryError:
      libraryResult.status === "rejected" ? libraryResult.reason instanceof Error ? libraryResult.reason.message : "Unable to load Ollama library models" : "",
  };
}

export function isRemoteLibraryModelName(name: string) {
	return isRemoteOnlyModelName(name.trim().toLowerCase());
}

export async function getLoadedOllamaModelUsages(baseUrl: string, modelNames: string[]) {
  const requestedModels = modelNames
    .map((modelName) => ({
      requestedName: modelName.trim(),
      normalizedName: normalizeModelName(modelName),
    }))
    .filter((model) => model.normalizedName !== "");

  if (requestedModels.length === 0) {
    return [] as Array<{
      requestedName: string;
      modelName: string;
      modelLoadedBytes: number | null;
      modelVramBytes: number | null;
    }>;
  }

  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/ps`, {
      signal: AbortSignal.timeout(2_000),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`ollama ps request failed with ${response.status}`);
    }

    const parsed = (await response.json()) as OllamaPsResponse;
    const loadedModels = new Map(
      (parsed.models || []).flatMap((model) => {
        const candidateName = model.name || model.model || "";
        const normalizedName = normalizeModelName(candidateName);
        if (!normalizedName) {
          return [];
        }
        return [[normalizedName, model] as const];
      }),
    );

    return requestedModels.map((requestedModel) => {
      const match = loadedModels.get(requestedModel.normalizedName);
      return {
        requestedName: requestedModel.requestedName,
        modelName: match?.name || match?.model || requestedModel.requestedName,
        modelLoadedBytes:
          typeof match?.size === "number" && Number.isFinite(match.size) ? match.size : null,
        modelVramBytes:
          typeof match?.size_vram === "number" && Number.isFinite(match.size_vram)
            ? match.size_vram
            : null,
      };
    });
  } catch {
    return requestedModels.map((requestedModel) => ({
      requestedName: requestedModel.requestedName,
      modelName: requestedModel.requestedName,
      modelLoadedBytes: null,
      modelVramBytes: null,
    }));
  }
}

export async function removeOllamaModel(baseUrl: string, model: string, signal?: AbortSignal) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/delete`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
    }),
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`ollama delete request failed with ${response.status}`);
  }

  return { ok: true };
}

export async function unloadOllamaModel(baseUrl: string, model: string, signal?: AbortSignal) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: "",
      stream: false,
      keep_alive: 0,
    }),
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    const body = (await response.text()).trim();
    throw new Error(
      body
        ? `ollama unload request failed with ${response.status}: ${body}`
        : `ollama unload request failed with ${response.status}`,
    );
  }

  return { ok: true };
}
