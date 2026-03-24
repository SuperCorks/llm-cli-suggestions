"use client";

import { useMemo } from "react";

import { SuggestionContextCell } from "@/components/suggestion-context-cell";
import { buildSuggestionContextSnapshot } from "@/components/suggestion-context";
import { SuggestionQualityControl } from "@/components/suggestion-quality-control";
import { formatDurationMs, formatTimestamp } from "@/lib/format";
import type { SuggestionRow } from "@/lib/types";

interface SuggestionsHistoryTableProps {
  rows: SuggestionRow[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function SuggestionsHistoryTable({ rows, selectedId, onSelect }: SuggestionsHistoryTableProps) {
  const entries = useMemo(
    () => rows.map((row) => ({ row, snapshot: buildSuggestionContextSnapshot(row) })),
    [rows],
  );

  return (
    <div className="table-wrap">
      <table className="suggestions-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Session</th>
            <th>Buffer</th>
            <th>Suggestion</th>
            <th>Source</th>
            <th>Model</th>
            <th>Latency</th>
            <th>Outcome</th>
            <th>Label</th>
            <th>Context</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(({ row, snapshot }) => (
            <tr key={row.id}>
              <td>{formatTimestamp(row.createdAtMs)}</td>
              <td>
                <code>{row.sessionId}</code>
              </td>
              <td>
                <code>{row.buffer}</code>
              </td>
              <td>
                <code>{row.suggestionText}</code>
              </td>
              <td>{row.source}</td>
              <td>{row.modelName || "n/a"}</td>
              <td>{formatDurationMs(row.latencyMs)}</td>
              <td>
                <span className={row.accepted ? "feed-badge accepted" : row.rejected ? "feed-badge rejected" : "feed-badge"}>
                  {row.accepted ? "Accepted" : row.rejected ? "Rejected" : "Unreviewed"}
                </span>
              </td>
              <td>
                <SuggestionQualityControl
                  suggestionId={row.id}
                  initialLabel={row.qualityLabel}
                />
              </td>
              <td className="context-cell">
                <SuggestionContextCell
                  title={snapshot.summaryTitle}
                  subtitle={snapshot.summarySubtitle}
                  selected={row.id === selectedId}
                  onSelect={() => onSelect(row.id)}
                />
              </td>
            </tr>
          ))}
          {entries.length === 0 ? (
            <tr>
              <td colSpan={10}>No suggestions matched the selected filters.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
