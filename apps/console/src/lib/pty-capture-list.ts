export function isRegexPtyCaptureRule(entry: string) {
  const trimmed = entry.trim();
  return trimmed.length >= 2 && trimmed.startsWith("/") && trimmed.endsWith("/");
}

export function normalizePtyCaptureList(value?: string | null) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawLine of (value || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (isRegexPtyCaptureRule(line)) {
      if (!seen.has(line)) {
        seen.add(line);
        normalized.push(line);
      }
      continue;
    }

    for (const rawEntry of line.split(",")) {
      const entry = rawEntry.trim();
      if (!entry || seen.has(entry)) {
        continue;
      }
      seen.add(entry);
      normalized.push(entry);
    }
  }

  return normalized.join("\n");
}

export function formatPtyCaptureListForEditor(value?: string | null) {
  return normalizePtyCaptureList(value);
}