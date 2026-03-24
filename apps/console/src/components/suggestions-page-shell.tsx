"use client";

import { ChevronDown, Copy, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Panel } from "@/components/panel";
import { PathHoverActions } from "@/components/path-hover-actions";
import { buildSuggestionContextSnapshot } from "@/components/suggestion-context";
import { SuggestionsHistoryTable } from "@/components/suggestions-history-table";
import type {
  SuggestionOutcome,
  SuggestionQualityFilter,
  SuggestionRow,
  SuggestionSort,
} from "@/lib/types";

const SORT_OPTIONS: Array<{ value: SuggestionSort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "latency-desc", label: "Highest latency" },
  { value: "latency-asc", label: "Lowest latency" },
  { value: "buffer-asc", label: "Buffer A-Z" },
  { value: "model-asc", label: "Model A-Z" },
  { value: "quality-desc", label: "Labeled first" },
];

interface SuggestionsPageShellProps {
  rows: SuggestionRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  pageWindow: number[];
  sourceOptions: string[];
  filters: {
    query: string;
    source: string;
    model: string;
    session: string;
    cwd: string;
    sort: SuggestionSort;
    outcome: SuggestionOutcome;
    quality: SuggestionQualityFilter;
    pageSize: string;
  };
}

function buildSuggestionsHref(
  filters: SuggestionsPageShellProps["filters"],
  overrides: Record<string, string | number | undefined>,
) {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      next.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === "") {
      next.delete(key);
      continue;
    }
    next.set(key, String(value));
  }

  const query = next.toString();
  return query ? `/suggestions?${query}` : "/suggestions";
}

function outcomeLabel(row: SuggestionRow) {
  if (row.accepted) {
    return "Accepted";
  }
  if (row.rejected) {
    return "Rejected";
  }
  return "Unreviewed";
}

function outcomeClassName(row: SuggestionRow) {
  if (row.accepted) {
    return "feed-badge accepted";
  }
  if (row.rejected) {
    return "feed-badge rejected";
  }
  return "feed-badge";
}

function describeActiveFilters(filters: SuggestionsPageShellProps["filters"]) {
  const items: string[] = [];

  if (filters.query) {
    items.push(`Query: ${filters.query}`);
  }
  if (filters.outcome !== "all") {
    items.push(`Outcome: ${filters.outcome}`);
  }
  if (filters.quality !== "all") {
    items.push(`Quality: ${filters.quality}`);
  }
  if (filters.source) {
    items.push(`Source: ${filters.source}`);
  }
  if (filters.model) {
    items.push(`Model: ${filters.model}`);
  }
  if (filters.session) {
    items.push(`Session: ${filters.session}`);
  }
  if (filters.cwd) {
    items.push(`CWD: ${filters.cwd}`);
  }
  if (filters.sort !== "newest") {
    items.push(`Sort: ${SORT_OPTIONS.find((option) => option.value === filters.sort)?.label || filters.sort}`);
  }
  if (filters.pageSize !== "25") {
    items.push(`Page Size: ${filters.pageSize} rows`);
  }

  return items;
}

export function SuggestionsPageShell({
  rows,
  total,
  page,
  pageSize,
  totalPages,
  startIndex,
  endIndex,
  pageWindow,
  sourceOptions,
  filters,
}: SuggestionsPageShellProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copiedField, setCopiedField] = useState<"context" | "id" | null>(null);
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);

  const entries = useMemo(
    () => rows.map((row) => ({ row, snapshot: buildSuggestionContextSnapshot(row) })),
    [rows],
  );
  const activeFilterSummary = describeActiveFilters(filters);

  const selectedEntry = entries.find((entry) => entry.row.id === selectedId) || null;

  useEffect(() => {
    if (selectedId === null) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedId(null);
        setCopiedField(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedId]);

  function closeSidebar() {
    setSelectedId(null);
    setCopiedField(null);
  }

  async function copyText(value: string, field: "context" | "id") {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField(null), 1400);
  }

  async function copySelectedContext() {
    if (!selectedEntry) {
      return;
    }
    await copyText(
      JSON.stringify(selectedEntry.snapshot.contextPayload, null, 2),
      "context",
    );
  }

  async function copySelectedId() {
    if (!selectedEntry) {
      return;
    }
    await copyText(String(selectedEntry.row.id), "id");
  }

  return (
    <div className="suggestions-page-layout">
      <div className="suggestions-page-main stack-lg">
        <Panel
          title="Filters & Sort"
          subtitle="Filter server-side from SQLite, then sort and page through the suggestion history."
          actions={
            <button
              type="button"
              className="panel-toggle-button"
              aria-expanded={!filtersCollapsed}
              aria-controls="suggestions-filters-panel-content"
              onClick={() => setFiltersCollapsed((value) => !value)}
            >
              {filtersCollapsed ? "Show Filters" : "Hide Filters"}
              <span
                className={
                  filtersCollapsed ? "panel-toggle-icon" : "panel-toggle-icon panel-toggle-icon-open"
                }
              >
                <ChevronDown aria-hidden="true" />
              </span>
            </button>
          }
        >
          <div id="suggestions-filters-panel-content">
            {filtersCollapsed ? (
              <div className="filters-collapsed-state stack-sm">
                <p className="helper-text">
                  {activeFilterSummary.length === 0
                    ? "No extra filters applied. Using newest first and 25 rows per page."
                    : `${activeFilterSummary.length} active ${activeFilterSummary.length === 1 ? "setting" : "settings"}.`}
                </p>
                {activeFilterSummary.length > 0 ? (
                  <div className="filters-collapsed-chips">
                    {activeFilterSummary.map((item) => (
                      <span key={item} className="filter-summary-chip">
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <form className="stack-md" method="get">
                <div className="form-grid">
                  <label>
                    Query
                    <input name="query" defaultValue={filters.query} placeholder="git status" />
                  </label>
                  <label>
                    Outcome
                    <select name="outcome" defaultValue={filters.outcome}>
                      <option value="all">All</option>
                      <option value="accepted">Accepted</option>
                      <option value="rejected">Rejected</option>
                      <option value="unreviewed">Unreviewed</option>
                    </select>
                  </label>
                  <label>
                    Quality Label
                    <select name="quality" defaultValue={filters.quality}>
                      <option value="all">All</option>
                      <option value="good">Good</option>
                      <option value="bad">Bad</option>
                      <option value="unlabeled">Unlabeled</option>
                    </select>
                  </label>
                  <label>
                    Sort
                    <select name="sort" defaultValue={filters.sort}>
                      {SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Source
                    <select name="source" defaultValue={filters.source}>
                      <option value="">All sources</option>
                      {sourceOptions.map((source) => (
                        <option key={source} value={source}>
                          {source}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Model
                    <input name="model" defaultValue={filters.model} placeholder="qwen2.5-coder:7b" />
                  </label>
                  <label>
                    Session
                    <input name="session" defaultValue={filters.session} />
                  </label>
                  <label>
                    CWD
                    <PathHoverActions pathValue={filters.cwd} label="Suggestions filter cwd" variant="input">
                      <input name="cwd" defaultValue={filters.cwd} />
                    </PathHoverActions>
                  </label>
                  <label>
                    Page Size
                    <select name="pageSize" defaultValue={filters.pageSize}>
                      <option value="25">25 rows</option>
                      <option value="50">50 rows</option>
                      <option value="100">100 rows</option>
                    </select>
                  </label>
                </div>
                <input type="hidden" name="page" value="1" />
                <div className="inline-actions">
                  <button type="submit">Apply Filters</button>
                  <a className="button-link" href="/suggestions">
                    Clear
                  </a>
                </div>
              </form>
            )}
          </div>
        </Panel>

        <Panel
          title="Suggestion History"
          subtitle={`Showing ${startIndex}-${endIndex} of ${total} suggestions.`}
        >
          <div className="suggestions-toolbar">
            <div className="suggestions-toolbar-copy">
              <strong>Page {page}</strong>
              <span>
                {total === 0 ? "No matching suggestions." : `${startIndex}-${endIndex} of ${total} rows`}
              </span>
            </div>
            <div className="pagination-controls">
              <a
                className={page <= 1 ? "pager-link disabled" : "pager-link"}
                href={buildSuggestionsHref(filters, { page: Math.max(1, page - 1) })}
                aria-disabled={page <= 1}
              >
                Prev
              </a>
              {pageWindow.map((pageNumber) => (
                <a
                  key={pageNumber}
                  className={pageNumber === page ? "pager-link active" : "pager-link"}
                  href={buildSuggestionsHref(filters, { page: pageNumber })}
                >
                  {pageNumber}
                </a>
              ))}
              <a
                className={page >= totalPages ? "pager-link disabled" : "pager-link"}
                href={buildSuggestionsHref(filters, { page: Math.min(totalPages, page + 1) })}
                aria-disabled={page >= totalPages}
              >
                Next
              </a>
            </div>
          </div>

          <SuggestionsHistoryTable rows={rows} selectedId={selectedId} onSelect={setSelectedId} />

          <div className="suggestions-toolbar suggestions-toolbar-bottom">
            <div className="suggestions-toolbar-copy">
              <strong>
                Sort: {SORT_OPTIONS.find((option) => option.value === filters.sort)?.label || "Newest first"}
              </strong>
              <span>{pageSize} rows per page</span>
            </div>
            <div className="pagination-controls">
              <a
                className={page <= 1 ? "pager-link disabled" : "pager-link"}
                href={buildSuggestionsHref(filters, { page: Math.max(1, page - 1) })}
                aria-disabled={page <= 1}
              >
                Prev
              </a>
              <a
                className={page >= totalPages ? "pager-link disabled" : "pager-link"}
                href={buildSuggestionsHref(filters, { page: Math.min(totalPages, page + 1) })}
                aria-disabled={page >= totalPages}
              >
                Next
              </a>
            </div>
          </div>
        </Panel>
      </div>

      {selectedEntry ? <div className="suggestion-sidebar-backdrop" onClick={closeSidebar} /> : null}

      {selectedEntry ? (
        <aside className="suggestion-sidebar suggestion-sidebar-open" aria-label="Suggestion details">
          <div className="stack-md suggestion-sidebar-shell suggestion-sidebar-stack">
            <div className="hero-card suggestion-sidebar-hero">
              <div className="suggestion-sidebar-hero-head">
                <div className="stack-sm suggestion-sidebar-title-group">
                  <div className="hero-card-topline">Suggestion Snapshot</div>
                  <h3>{selectedEntry.row.suggestionText}</h3>
                </div>
                <button
                  type="button"
                  className="icon-button suggestion-sidebar-close"
                  onClick={closeSidebar}
                  aria-label="Close suggestion details"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
              <p>
                <span className={outcomeClassName(selectedEntry.row)}>
                  {outcomeLabel(selectedEntry.row)}
                </span>{" "}
                <span className="muted-text">{selectedEntry.row.source}</span>
              </p>
              <div className="inline-actions suggestion-sidebar-actions">
                <Link href={selectedEntry.snapshot.replayHref} className="button-secondary" prefetch={false}>
                  Replay In Inspector
                </Link>
                <button type="button" className="button-secondary" onClick={() => void copySelectedContext()}>
                  <Copy aria-hidden="true" />
                  {copiedField === "context" ? "Copied" : "Copy Context"}
                </button>
              </div>
            </div>

            <div className="detail-block">
              <h3>Summary</h3>
              <dl className="meta-list">
                <div>
                  <dt>Suggestion ID</dt>
                  <dd className="meta-list-value-with-action">
                    <span>{selectedEntry.row.id}</span>
                    <button
                      type="button"
                      className="button-secondary inline-field-button"
                      onClick={() => void copySelectedId()}
                    >
                      <Copy aria-hidden="true" />
                      {copiedField === "id" ? "Copied" : "Copy ID"}
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Session</dt>
                  <dd>{selectedEntry.row.sessionId}</dd>
                </div>
                <div>
                  <dt>Buffer</dt>
                  <dd><code>{selectedEntry.row.buffer}</code></dd>
                </div>
                <div>
                  <dt>Accepted Command</dt>
                  <dd>{selectedEntry.row.acceptedCommand || "n/a"}</dd>
                </div>
                <div>
                  <dt>Actual Command</dt>
                  <dd>{selectedEntry.row.actualCommand || "n/a"}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{selectedEntry.snapshot.structuredContext.modelName || selectedEntry.row.modelName || "n/a"}</dd>
                </div>
                <div>
                  <dt>Strategy</dt>
                  <dd>{selectedEntry.snapshot.structuredContext.request.strategy || "n/a"}</dd>
                </div>
                <div>
                  <dt>Branch</dt>
                  <dd>{selectedEntry.snapshot.structuredContext.request.branch || "n/a"}</dd>
                </div>
                <div>
                  <dt>CWD</dt>
                  <dd>
                    {selectedEntry.snapshot.structuredContext.request.cwd ? (
                      <PathHoverActions
                        pathValue={selectedEntry.snapshot.structuredContext.request.cwd}
                        label="Suggestion cwd"
                      >
                        <span>{selectedEntry.snapshot.structuredContext.request.cwd}</span>
                      </PathHoverActions>
                    ) : (
                      "n/a"
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="detail-block">
              <h3>Last Command Context</h3>
              <dl className="meta-list">
                <div>
                  <dt>Commands</dt>
                  <dd>{selectedEntry.snapshot.structuredContext.lastCommandContext.length}</dd>
                </div>
              </dl>
              <pre className="code-block suggestion-sidebar-pre">
                {selectedEntry.snapshot.structuredContext.lastCommandContext.length > 0
                  ? selectedEntry.snapshot.structuredContext.lastCommandContext
                      .map((entry, index) =>
                        [
                          `${index + 1}. ${entry.command || "n/a"}`,
                          `exit: ${entry.exitCode}`,
                          entry.stdoutExcerpt ? `stdout:\n${entry.stdoutExcerpt}` : "",
                          entry.stderrExcerpt ? `stderr:\n${entry.stderrExcerpt}` : "",
                        ]
                          .filter(Boolean)
                          .join("\n"),
                      )
                      .join("\n\n")
                  : "No last command context recorded."}
              </pre>
            </div>

            <div className="detail-block">
              <h3>Recent Output Context</h3>
              <dl className="meta-list">
                <div>
                  <dt>Entries</dt>
                  <dd>{selectedEntry.snapshot.structuredContext.recentOutputContext.length}</dd>
                </div>
              </dl>
              <pre className="code-block suggestion-sidebar-pre">
                {selectedEntry.snapshot.structuredContext.recentOutputContext.length > 0
                  ? selectedEntry.snapshot.structuredContext.recentOutputContext
                      .map((entry, index) =>
                        [
                          `${index + 1}. ${entry.command || "n/a"}`,
                          `exit: ${entry.exitCode}`,
                          `score: ${entry.score}`,
                          entry.stdoutExcerpt ? `stdout:\n${entry.stdoutExcerpt}` : "",
                          entry.stderrExcerpt ? `stderr:\n${entry.stderrExcerpt}` : "",
                        ]
                          .filter(Boolean)
                          .join("\n"),
                      )
                      .join("\n\n")
                  : "No recent output context recorded."}
              </pre>
            </div>

            <div className="detail-block">
              <h3>Retrieved Context</h3>
              <dl className="meta-list">
                <div>
                  <dt>Recent Commands</dt>
                  <dd>{selectedEntry.snapshot.structuredContext.recentCommands.length}</dd>
                </div>
                <div>
                  <dt>History Matches</dt>
                  <dd>{selectedEntry.snapshot.structuredContext.retrievedContext.historyMatches.length}</dd>
                </div>
                <div>
                  <dt>Path Matches</dt>
                  <dd>{selectedEntry.snapshot.structuredContext.retrievedContext.pathMatches.length}</dd>
                </div>
                <div>
                  <dt>Branch Matches</dt>
                  <dd>{selectedEntry.snapshot.structuredContext.retrievedContext.gitBranchMatches.length}</dd>
                </div>
                <div>
                  <dt>Project Tasks</dt>
                  <dd>{selectedEntry.snapshot.structuredContext.retrievedContext.projectTasks.length}</dd>
                </div>
                <div>
                  <dt>Task Matches</dt>
                  <dd>{selectedEntry.snapshot.structuredContext.retrievedContext.projectTaskMatches.length}</dd>
                </div>
              </dl>
              <pre className="code-block suggestion-sidebar-pre">
                {[
                  selectedEntry.snapshot.structuredContext.recentCommands.length
                    ? `recent commands:\n- ${selectedEntry.snapshot.structuredContext.recentCommands.join("\n- ")}`
                    : "",
                  selectedEntry.snapshot.structuredContext.retrievedContext.historyMatches.length
                    ? `history matches:\n- ${selectedEntry.snapshot.structuredContext.retrievedContext.historyMatches.join("\n- ")}`
                    : "",
                  selectedEntry.snapshot.structuredContext.retrievedContext.pathMatches.length
                    ? `path matches:\n- ${selectedEntry.snapshot.structuredContext.retrievedContext.pathMatches.join("\n- ")}`
                    : "",
                  selectedEntry.snapshot.structuredContext.retrievedContext.gitBranchMatches.length
                    ? `branch matches:\n- ${selectedEntry.snapshot.structuredContext.retrievedContext.gitBranchMatches.join("\n- ")}`
                    : "",
                  selectedEntry.snapshot.structuredContext.retrievedContext.projectTasks.length
                    ? `project tasks:\n- ${selectedEntry.snapshot.structuredContext.retrievedContext.projectTasks.join("\n- ")}`
                    : "",
                  selectedEntry.snapshot.structuredContext.retrievedContext.projectTaskMatches.length
                    ? `task matches:\n- ${selectedEntry.snapshot.structuredContext.retrievedContext.projectTaskMatches.join("\n- ")}`
                    : "",
                ].filter(Boolean).join("\n\n") || "No retrieved values recorded."}
              </pre>
            </div>

            <div className="detail-block">
              <h3>Prompt Snapshot</h3>
              <pre className="code-block code-block-tall suggestion-sidebar-pre">
                {selectedEntry.row.promptText || "No prompt snapshot."}
              </pre>
            </div>

            <div className="detail-block">
              <h3>Structured Snapshot</h3>
              <pre className="code-block code-block-tall suggestion-sidebar-pre">
                {JSON.stringify(selectedEntry.snapshot.structuredContext, null, 2)}
              </pre>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
