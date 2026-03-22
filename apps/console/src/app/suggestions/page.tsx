import { unstable_noStore as noStore } from "next/cache";

import { SuggestionsPageShell } from "@/components/suggestions-page-shell";
import { listSuggestionSources, listSuggestions } from "@/lib/server/queries";
import type { SuggestionOutcome, SuggestionQualityFilter, SuggestionSort } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function normalizeSort(value?: string): SuggestionSort {
  if (
    value === "oldest" ||
    value === "latency-desc" ||
    value === "latency-asc" ||
    value === "buffer-asc" ||
    value === "model-asc" ||
    value === "quality-desc"
  ) {
    return value;
  }
  return "newest";
}

function normalizeOutcome(value?: string): SuggestionOutcome {
  if (value === "accepted" || value === "rejected" || value === "unreviewed") {
    return value;
  }
  return "all";
}

function normalizeQuality(value?: string): SuggestionQualityFilter {
  if (value === "good" || value === "bad" || value === "unlabeled") {
    return value;
  }
  return "all";
}

function normalizePageSize(value?: string) {
  const parsed = Number.parseInt(value || "25", 10) || 25;
  if (parsed === 50 || parsed === 100) {
    return parsed;
  }
  return 25;
}

function getPageWindow(currentPage: number, totalPages: number) {
  const pages = new Set<number>([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  return [...pages].filter((page) => page >= 1 && page <= totalPages).sort((left, right) => left - right);
}

export default async function SuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(getString(params.page) || "1", 10) || 1);
  const pageSize = normalizePageSize(getString(params.pageSize));
  const sort = normalizeSort(getString(params.sort));
  const outcome = normalizeOutcome(getString(params.outcome));
  const quality = normalizeQuality(getString(params.quality));

  const result = listSuggestions({
    page,
    pageSize,
    source: getString(params.source) || undefined,
    model: getString(params.model) || undefined,
    session: getString(params.session) || undefined,
    cwd: getString(params.cwd) || undefined,
    query: getString(params.query) || undefined,
    outcome,
    quality,
    sort,
  });
  const sourceFilter = getString(params.source);
  const sourceOptions = [...new Set([...listSuggestionSources(), sourceFilter].filter(Boolean))];

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const startIndex = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const endIndex = Math.min(result.total, result.page * result.pageSize);
  const pageWindow = getPageWindow(result.page, totalPages);

  return (
    <div className="stack-lg page-shell-wide">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Explorer</span>
          <h1>Suggestions</h1>
          <p>
            Inspect generated suggestions, grade them for future fine-tuning, and compare source,
            latency, and context without leaving the console.
          </p>
        </div>
      </div>

      <SuggestionsPageShell
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        totalPages={totalPages}
        startIndex={startIndex}
        endIndex={endIndex}
        pageWindow={pageWindow}
        sourceOptions={sourceOptions}
        filters={{
          query: getString(params.query),
          source: sourceFilter,
          model: getString(params.model),
          session: getString(params.session),
          cwd: getString(params.cwd),
          sort,
          outcome,
          quality,
          pageSize: String(pageSize),
        }}
      />
    </div>
  );
}
