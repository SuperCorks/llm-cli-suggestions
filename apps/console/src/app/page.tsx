import { LiveActivityStream } from "@/components/live-activity-stream";
import { PathHoverActions } from "@/components/path-hover-actions";
import { Panel } from "@/components/panel";
import {
  formatCompactNumber,
  formatDurationMs,
  formatPercent,
  formatTimestamp,
} from "@/lib/format";
import { getOverviewData, getRecentActivitySignals } from "@/lib/server/queries";
import { getRuntimeStatusWithHealth } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";

export default async function Home() {
  const overview = getOverviewData();
  const runtime = await getRuntimeStatusWithHealth();
  const recentSignals = getRecentActivitySignals(6);
  const cards = [
    { label: "Avg. latency", value: formatDurationMs(overview.averageModelLatency) },
    { label: "Acceptance rate", value: formatPercent(overview.acceptanceRate) },
    { label: "Total suggestions", value: formatCompactNumber(overview.totals.suggestions) },
    { label: "Active model", value: runtime.health.modelName },
  ];

  return (
    <div className="stack-lg">
      <div className="page-heading">
        <div>
          <h1>Dashboard</h1>
          <p>
            See daemon health, model performance, recent suggestions, and the shape of the local
            learning dataset at a glance.
          </p>
        </div>
      </div>

      <div className="stats-grid">
        {cards.map((card) => (
          <div key={card.label} className="stat-card">
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </div>
        ))}
      </div>

      <div className="overview-grid">
        <Panel title="Live Activity" subtitle="Recent daemon and suggestion signals rendered as a terminal tape.">
          <LiveActivityStream initialSignals={recentSignals} />
        </Panel>

        <Panel title="Top Commands" subtitle="Most frequent command patterns found in SQLite.">
          <div className="table-wrap">
            <table className="top-commands-table">
              <thead>
                <tr>
                  <th>Command</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {overview.topCommands.map((row) => (
                  <tr key={row.command}>
                    <td>
                      <code className="truncate-command" title={row.command}>
                        {row.command}
                      </code>
                    </td>
                    <td>{row.count}</td>
                  </tr>
                ))}
                {overview.topCommands.length === 0 ? (
                  <tr>
                    <td colSpan={2}>No command data yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="overview-grid lower">
        <Panel title="Recent Suggestions" subtitle="Latest suggestions with feedback status and source context.">
          <ul className="suggestion-feed">
            {overview.recentSuggestions.map((row) => (
              <li key={row.id} className="suggestion-feed-item">
                <div>
                  <code>{row.suggestionText}</code>
                  <p>
                    {row.buffer || "empty buffer"} · {row.source} · {formatTimestamp(row.createdAtMs)}
                  </p>
                </div>
                <span className={row.accepted ? "feed-badge accepted" : row.rejected ? "feed-badge rejected" : "feed-badge"}>
                  {row.accepted ? "Accepted" : row.rejected ? "Ignored" : "Queued"}
                </span>
              </li>
            ))}
            {overview.recentSuggestions.length === 0 ? (
              <li className="suggestion-feed-item">
                <div>
                  <code>No recent suggestions</code>
                  <p>Start typing in your terminal to populate this feed.</p>
                </div>
              </li>
            ) : null}
          </ul>
        </Panel>

        <div className="stack-lg">
          <Panel title="Model Insights" subtitle="A quick read on current latency and rejection pressure.">
            <div className="insight-card">
              <h3>{runtime.health.modelName} is driving the current console.</h3>
              <p>
                Average latency is {formatDurationMs(overview.averageModelLatency)} with an overall
                acceptance rate of {formatPercent(overview.acceptanceRate)}.
              </p>
              <ul className="metric-list">
                {overview.topRejectedSuggestions.slice(0, 3).map((row) => (
                  <li key={row.suggestion}>
                    <code>{row.suggestion}</code>
                    <strong>{row.count} rejects</strong>
                  </li>
                ))}
                {overview.topRejectedSuggestions.length === 0 ? <li>No rejected suggestions yet.</li> : null}
              </ul>
            </div>
          </Panel>

          <Panel title="Latency By Model" subtitle="Average suggestion latency grouped by model name.">
            <ul className="metric-list">
              {overview.latencyByModel.map((row) => (
                <li key={row.model}>
                  <span>{row.model}</span>
                  <strong>
                    {formatDurationMs(row.avgLatencyMs)} · {row.count} samples
                  </strong>
                </li>
              ))}
              {overview.latencyByModel.length === 0 ? <li>No model latency samples yet.</li> : null}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel title="Acceptance By Path" subtitle="Feedback acceptance rate grouped by working directory when available.">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Path</th>
                <th>Accepted</th>
                <th>Rejected</th>
                <th>Acceptance Rate</th>
              </tr>
            </thead>
            <tbody>
              {overview.acceptanceByPath.map((row) => (
                <tr key={row.path}>
                  <td>
                    {row.path === "(no path)" ? (
                      row.path
                    ) : (
                      <PathHoverActions pathValue={row.path} label="Acceptance path" variant="inline">
                        <span>{row.path}</span>
                      </PathHoverActions>
                    )}
                  </td>
                  <td>{row.accepted}</td>
                  <td>{row.rejected}</td>
                  <td>{formatPercent(row.acceptanceRate)}</td>
                </tr>
              ))}
              {overview.acceptanceByPath.length === 0 ? (
                <tr>
                  <td colSpan={4}>No path acceptance data yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
