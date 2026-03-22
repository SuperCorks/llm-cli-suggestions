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
  const names = (parsed.models || [])
    .map((model) => model.name || model.model || "")
    .filter(Boolean);

  const inspectionResults = await Promise.all(
    names.map(async (name) => ({
      name,
      remoteReference: await isRemoteReferenceModel(baseUrl, name),
    })),
  );

  return inspectionResults
    .filter((model) => !model.remoteReference)
    .map((model) => ({
      name: model.name,
      installed: true,
      source: "installed" as const,
    }));
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

    const isCloudModel =
      capabilities.includes("cloud") ||
      />\s*cloud\s*<\/span>/i.test(block) ||
      name.endsWith(":cloud");

    if (isCloudModel) {
      continue;
    }

    const sizes = Array.from(
      block.matchAll(/<span[^>]*x-test-size[^>]*>([^<]+)<\/span>/gi),
    )
      .map((match) => match[1]?.trim().toLowerCase() || "")
      .filter(Boolean);

    if (sizes.length > 0) {
      for (const size of sizes) {
        models.push({
          name: `${name}:${size}`,
          installed: false,
          source: "library",
          capabilities,
        });
      }
      continue;
    }

    models.push({
      name,
      installed: false,
      source: "library",
      capabilities,
    });
  }
  return models;
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
  const commandPattern = new RegExp(
    `ollama\\s+run\\s+(${escapedFamily}:[a-z0-9][a-z0-9._-]*)`,
    "gi",
  );

  for (const match of html.matchAll(commandPattern)) {
    const name = match[1]?.trim().toLowerCase();
    if (!name || seen.has(name)) {
      continue;
    }

    const tag = name.slice(family.length + 1);
    if (!tag || tag === "latest" || tag.endsWith("-cloud") || tag === "cloud") {
      continue;
    }

    seen.add(name);
    models.push({
      name,
      installed: false,
      source: "library",
      capabilities,
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
        capabilities: [],
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
  const gemma3Capabilities =
    models.find((model) => model.name.startsWith("gemma3:"))?.capabilities || [];

  try {
    const supplementalGemma3Models = await fetchSupplementalFamilyVariants(
      "gemma3",
      gemma3Capabilities,
    );
    return uniqueSortedModels([...models, ...supplementalGemma3Models]);
  } catch {
    return models;
  }
}

async function isRemoteReferenceModel(baseUrl: string, modelName: string) {
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
      return false;
    }

    const parsed = (await response.json()) as OllamaShowResponse;
    const hasRemoteRef = Boolean(parsed.remote_model || parsed.remote_host);
    const hasLocalDetails = Boolean(
      parsed.details?.format ||
        parsed.details?.family ||
        parsed.details?.parameter_size ||
        parsed.details?.quantization_level,
    );

    return hasRemoteRef && !hasLocalDetails;
  } catch {
    return false;
  }
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

export async function removeOllamaModel(baseUrl: string, model: string) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/delete`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`ollama delete request failed with ${response.status}`);
  }

  return { ok: true };
}
