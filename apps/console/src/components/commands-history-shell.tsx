"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { buildCommandContextSnapshot } from "@/components/command-context";
import { PathHoverActions } from "@/components/path-hover-actions";
import { SuggestionContextCell } from "@/components/suggestion-context-cell";
import { formatDurationMs, formatTimestamp } from "@/lib/format";
import type { CommandRow } from "@/lib/types";

interface CommandsHistoryShellProps {
  rows: CommandRow[];
}

export function CommandsHistoryShell({ rows }: CommandsHistoryShellProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const entries = useMemo(
    () => rows.map((row) => ({ row, snapshot: buildCommandContextSnapshot(row) })),
    [rows],
  );

  const selectedEntry = entries.find((entry) => entry.row.id === selectedId) || null;

  useEffect(() => {
    if (!selectedEntry) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedEntry]);

  function closeSidebar() {
    setSelectedId(null);
  }

  return (
    <div className="suggestions-page-layout">
      <div className="suggestions-page-main">
        <div className="table-wrap">
          <table className="commands-table">
            <thead>
              <tr>
                <th>Finished</th>
                <th>Session</th>
                <th>Command</th>
                <th>Exit</th>
                <th>Duration</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ row, snapshot }) => (
                <tr key={row.id}>
                  <td>{formatTimestamp(row.finishedAtMs)}</td>
                  <td>
                    <code>{row.sessionId}</code>
                  </td>
                  <td>
                    <code>{row.commandText}</code>
                  </td>
                  <td>{row.exitCode}</td>
                  <td>{formatDurationMs(row.durationMs)}</td>
                  <td className="context-cell">
                    <SuggestionContextCell
                      title={snapshot.summaryTitle}
                      subtitle={snapshot.summarySubtitle}
                      selected={row.id === selectedId}
                      onSelect={() => setSelectedId(row.id)}
                    />
                  </td>
                </tr>
              ))}
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={6}>No commands matched the selected filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {selectedEntry ? <div className="suggestion-sidebar-backdrop" onClick={closeSidebar} /> : null}

      {selectedEntry ? (
        <aside className="suggestion-sidebar suggestion-sidebar-open" aria-label="Command details">
          <div className="stack-md suggestion-sidebar-shell suggestion-sidebar-stack">
            <div className="hero-card suggestion-sidebar-hero">
              <div className="suggestion-sidebar-hero-head">
                <div className="stack-sm suggestion-sidebar-title-group">
                  <div className="hero-card-topline">Command Snapshot</div>
                  <h3>{selectedEntry.row.commandText}</h3>
                </div>
                <button
                  type="button"
                  className="icon-button suggestion-sidebar-close"
                  onClick={closeSidebar}
                  aria-label="Close command details"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
              <p>
                <span
                  className={
                    selectedEntry.row.exitCode === 0 ? "feed-badge accepted" : "feed-badge rejected"
                  }
                >
                  Exit {selectedEntry.row.exitCode}
                </span>{" "}
                <span className="muted-text">
                  Finished {formatTimestamp(selectedEntry.row.finishedAtMs)}
                </span>
              </p>
            </div>

            <div className="detail-block">
              <h3>Summary</h3>
              <dl className="meta-list">
                <div>
                  <dt>Session</dt>
                  <dd>{selectedEntry.row.sessionId}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{formatDurationMs(selectedEntry.row.durationMs)}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{formatTimestamp(selectedEntry.row.startedAtMs)}</dd>
                </div>
                <div>
                  <dt>Finished</dt>
                  <dd>{formatTimestamp(selectedEntry.row.finishedAtMs)}</dd>
                </div>
                <div>
                  <dt>Branch</dt>
                  <dd>{selectedEntry.row.branch || "n/a"}</dd>
                </div>
                <div>
                  <dt>CWD</dt>
                  <dd>
                    {selectedEntry.row.cwd ? (
                      <PathHoverActions pathValue={selectedEntry.row.cwd} label="Command cwd">
                        <span>{selectedEntry.row.cwd}</span>
                      </PathHoverActions>
                    ) : (
                      "n/a"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Repo Root</dt>
                  <dd>
                    {selectedEntry.row.repoRoot ? (
                      <PathHoverActions pathValue={selectedEntry.row.repoRoot} label="Command repo root">
                        <span>{selectedEntry.row.repoRoot}</span>
                      </PathHoverActions>
                    ) : (
                      "n/a"
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="detail-block">
              <h3>Stdout</h3>
              <pre className="code-block code-block-tall suggestion-sidebar-pre">
                {selectedEntry.row.stdoutExcerpt || "No stdout excerpt recorded."}
              </pre>
            </div>

            <div className="detail-block">
              <h3>Stderr</h3>
              <pre className="code-block code-block-tall suggestion-sidebar-pre">
                {selectedEntry.row.stderrExcerpt || "No stderr excerpt recorded."}
              </pre>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
