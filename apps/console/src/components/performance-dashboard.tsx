import Link from "next/link";

import {
  PerformanceLatencyDistributionPlot,
  PerformanceLatencyTrendPlot,
} from "@/components/performance-latency-trend-plot";
import { Panel } from "@/components/panel";
import { PathHoverActions } from "@/components/path-hover-actions";
import {
  formatCompactNumber,
  formatDurationMs,
  formatPercent,
  formatTimestamp,
} from "@/lib/format";
import type { PerformanceDashboardData } from "@/lib/server/performance";

interface PerformanceDashboardProps {
  data: PerformanceDashboardData;
  activeModel: string;
}

const STATE_COLORS = {
  cold: "#f3c47d",
  hot: "#8bd39f",
  unknown: "#b3c8e7",
  "not-applicable": "#5f6672",
} as const;

export function PerformanceDashboard({ data, activeModel }: PerformanceDashboardProps) {
  const rangeSummary = `${formatTimestamp(data.filters.startMs)} to ${formatTimestamp(data.filters.endMs)}`;
  const comparisonSummary = `${formatTimestamp(data.comparisonWindow.startMs)} to ${formatTimestamp(data.comparisonWindow.endMs)}`;
  const instrumentationRate =
    data.instrumentation.modelInvokedCount > 0
      ? data.instrumentation.instrumentedCount / data.instrumentation.modelInvokedCount
      : 0;

  return (
    <div className="stack-lg page-shell-wide">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Performance</span>
          <h1>Latency Dashboard</h1>
          <p>
            Break down end-to-end suggestion latency by cold starts, hot runs, request phase, and
            the paths or prefixes that keep dragging the tail.
          </p>
        </div>
      </div>

      <Panel
        title="Filters & Scope"
        subtitle="Default to the active model, compare windows by date or hour, and narrow the analysis to the slices that matter."
        actions={<Link href="/performance" className="button-secondary">Reset</Link>}
      >
        <form className="stack-md" method="get">
          <div className="form-grid performance-filter-grid">
            <label>
              Range Preset
              <select name="preset" defaultValue={data.filters.preset}>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last-24h">Last 24 Hours</option>
                <option value="last-7d">Last 7 Days</option>
                <option value="last-30d">Last 30 Days</option>
                <option value="all-time">All Time</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label>
              Start
              <input name="start" type="datetime-local" defaultValue={data.filters.startInput} />
            </label>
            <label>
              End
              <input name="end" type="datetime-local" defaultValue={data.filters.endInput} />
            </label>
            <label>
              Model
              <select name="model" defaultValue={data.filters.model || activeModel}>
                <option value="">All models</option>
                {[...new Set([activeModel, ...data.modelOptions].filter(Boolean))].map((modelName) => (
                  <option key={modelName} value={modelName}>
                    {modelName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Source
              <select name="source" defaultValue={data.filters.source}>
                <option value="">All sources</option>
                {data.sourceOptions.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start State
              <select name="startState" defaultValue={data.filters.startState}>
                <option value="all">All states</option>
                <option value="cold">Cold / wake required</option>
                <option value="hot">Hot / already resident</option>
                <option value="unknown">Unknown state</option>
                <option value="not-applicable">No model invocation</option>
              </select>
            </label>
          </div>
          <div className="inline-actions">
            <button type="submit">Apply</button>
            <p className="helper-text">
              Current window: {rangeSummary}. Previous comparison window: {comparisonSummary}.
            </p>
          </div>
        </form>
        <div className="filters-collapsed-chips performance-filter-chips">
          <span className="filter-summary-chip">Model: {data.filters.model || "All models"}</span>
          <span className="filter-summary-chip">Source: {data.filters.source || "All sources"}</span>
          <span className="filter-summary-chip">
            Start State: {data.filters.startState === "all" ? "All states" : data.filters.startState}
          </span>
          <span className="filter-summary-chip">Rows: {formatCompactNumber(data.summary.totalSuggestions)}</span>
        </div>
      </Panel>

      <div className="stats-grid performance-stats-grid">
        <StatCard
          label="Avg. request latency"
          value={formatDurationMs(data.summary.avgLatencyMs)}
          detail={formatDelta(data.summary.avgLatencyMs, data.previousSummary.avgLatencyMs, "ms")}
        />
        <StatCard
          label="P95 latency"
          value={formatDurationMs(data.summary.p95LatencyMs)}
          detail={formatDelta(data.summary.p95LatencyMs, data.previousSummary.p95LatencyMs, "ms")}
        />
        <StatCard
          label="Cold-start penalty"
          value={data.summary.coldPenaltyMs === null ? "n/a" : formatDurationMs(data.summary.coldPenaltyMs)}
          detail="Average cold minus hot request latency"
        />
        <StatCard
          label="Cold-start share"
          value={formatPercent(data.summary.coldShare)}
          detail={formatDelta(data.summary.coldShare * 100, data.previousSummary.coldShare * 100, "pp")}
        />
        <StatCard
          label="Model-invoked requests"
          value={formatCompactNumber(data.summary.modelInvokedCount)}
          detail={`${formatPercent(data.summary.modelInvokedCount / Math.max(1, data.summary.totalSuggestions))} of filtered rows`}
        />
      </div>

      <div className="performance-grid performance-grid-featured">
        <Panel
          title="Latency Trend"
          subtitle="Track average and p95 latency across the selected window, with hot and cold request curves layered on top."
        >
          <PerformanceLatencyTrendPlot
            points={data.timeline.points}
            bucketLabelFormat={data.timeline.bucketLabelFormat}
          />
        </Panel>

        <Panel
          title="Start State Split"
          subtitle="See how often the model had to wake up and what that did to the tail."
        >
          <div className="stack-md">
            <div className="performance-state-rail">
              {data.startStates.map((state) => (
                <div
                  key={state.key}
                  className="performance-state-segment"
                  style={{
                    width: `${Math.max(state.share * 100, 6)}%`,
                    background: STATE_COLORS[state.key],
                  }}
                  title={`${state.label}: ${formatCompactNumber(state.count)} rows`}
                />
              ))}
            </div>
            <ul className="metric-list performance-state-list">
              {data.startStates.map((state) => (
                <li key={state.key}>
                  <div className="performance-state-copy">
                    <span className="performance-legend">
                      <span
                        className="performance-legend-dot"
                        style={{ background: STATE_COLORS[state.key] }}
                        aria-hidden="true"
                      />
                      {state.label}
                    </span>
                    <small>
                      {formatCompactNumber(state.count)} rows · {formatPercent(state.share)}
                    </small>
                  </div>
                  <div className="performance-state-metrics">
                    <strong>{formatDurationMs(state.p95LatencyMs)}</strong>
                    <small>
                      avg {formatDurationMs(state.avgLatencyMs)}
                      {state.avgLoadDurationMs > 0 ? ` · load ${formatDurationMs(state.avgLoadDurationMs)}` : ""}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
            <p className="helper-text">
              Instrumentation coverage: {formatPercent(instrumentationRate)} of model-invoked rows
              {data.instrumentation.unknownStartStateCount > 0
                ? `, with ${formatCompactNumber(data.instrumentation.unknownStartStateCount)} row(s) still missing wake/load metadata.`
                : "."}
            </p>
          </div>
        </Panel>
      </div>

      <div className="performance-grid">
        <Panel
          title="Latency Distribution"
          subtitle="Spot whether the pain is concentrated in the tail or spread across the whole request mix."
        >
          <LatencyHistogramChart rows={data.histogram} />
        </Panel>

        <Panel
          title="Where Time Goes"
          subtitle="Average request phase breakdown for fully instrumented cold and hot model requests."
        >
          <div className="stack-md">
            {data.stageBreakdown.map((row) => (
              <StageBreakdownRow key={row.key} row={row} />
            ))}
            {data.stageBreakdown.length === 0 ? (
              <p className="helper-text">No instrumented model rows matched the current filters.</p>
            ) : null}
          </div>
        </Panel>
      </div>

      <div className="performance-grid">
        <Panel
          title="Path Hotspots"
          subtitle="The slowest working directories by tail latency, so we can see where context shape or model wake-ups hurt most."
        >
          <div className="table-wrap">
            <table className="performance-table">
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Samples</th>
                  <th>Avg.</th>
                  <th>P95</th>
                  <th>Cold Share</th>
                </tr>
              </thead>
              <tbody>
                {data.cwdLeaderboard.map((row) => (
                  <tr key={row.path}>
                    <td>
                      {row.path === "(no path)" ? (
                        row.path
                      ) : (
                        <PathHoverActions pathValue={row.path} label="Latency path" variant="inline">
                          <span>{row.path}</span>
                        </PathHoverActions>
                      )}
                    </td>
                    <td>{formatCompactNumber(row.count)}</td>
                    <td>{formatDurationMs(row.avgLatencyMs)}</td>
                    <td>{formatDurationMs(row.p95LatencyMs)}</td>
                    <td>{formatPercent(row.coldShare)}</td>
                  </tr>
                ))}
                {data.cwdLeaderboard.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No path hotspots matched the current filters.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Slow Buffer Patterns"
          subtitle="Repeated prefixes with the highest sustained latency so we can find problem prompts or wake-heavy flows."
        >
          <ul className="metric-list performance-hotspot-list">
            {data.bufferLeaderboard.map((row) => (
              <li key={row.buffer}>
                <div>
                  <code>{row.buffer}</code>
                  <p className="helper-text">
                    {formatCompactNumber(row.count)} rows · {formatCompactNumber(row.coldCount)} cold
                  </p>
                </div>
                <div className="performance-hotspot-metrics">
                  <strong>{formatDurationMs(row.avgLatencyMs)}</strong>
                  <small>p95 {formatDurationMs(row.p95LatencyMs)}</small>
                </div>
              </li>
            ))}
            {data.bufferLeaderboard.length === 0 ? (
              <li>No repeated buffers met the hotspot threshold in this slice.</li>
            ) : null}
          </ul>
        </Panel>
      </div>

      <Panel
        title="Source Leaderboard"
        subtitle="Compare latency shape by suggestion source to see where the tail lives."
      >
        <div className="performance-source-grid">
          {data.sourceBreakdown.map((row) => (
            <article key={row.source} className="performance-source-card">
              <div className="performance-source-card-top">
                <span>{row.source}</span>
                <strong>{formatDurationMs(row.avgLatencyMs)}</strong>
              </div>
              <dl className="meta-list performance-source-meta">
                <div>
                  <dt>Samples</dt>
                  <dd>{formatCompactNumber(row.count)}</dd>
                </div>
                <div>
                  <dt>P95</dt>
                  <dd>{formatDurationMs(row.p95LatencyMs)}</dd>
                </div>
                <div>
                  <dt>Cold Share</dt>
                  <dd>{formatPercent(row.coldShare)}</dd>
                </div>
              </dl>
            </article>
          ))}
          {data.sourceBreakdown.length === 0 ? (
            <p className="helper-text">No source data matched the current filters.</p>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="stat-card performance-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p className="helper-text">{detail}</p>
    </div>
  );
}

function LatencyHistogramChart({
  rows,
}: {
  rows: PerformanceDashboardData["histogram"];
}) {
  return <PerformanceLatencyDistributionPlot rows={rows} />;
}

function StageBreakdownRow({
  row,
}: {
  row: PerformanceDashboardData["stageBreakdown"][number];
}) {
  const total = Math.max(row.avgRequestLatencyMs, 1);
  const segments = [
    { label: "Load", value: row.avgLoadDurationMs, color: STATE_COLORS.cold },
    { label: "Prompt", value: row.avgPromptEvalDurationMs, color: "var(--primary)" },
    { label: "Decode", value: row.avgEvalDurationMs, color: STATE_COLORS.hot },
    { label: "Overhead", value: row.avgOverheadDurationMs, color: "rgba(95, 102, 114, 0.85)" },
  ];

  return (
    <div className="performance-stage-row">
      <div className="performance-stage-copy">
        <h3>{row.label}</h3>
        <p className="helper-text">
          {formatCompactNumber(row.count)} rows · avg request {formatDurationMs(row.avgRequestLatencyMs)}
          {row.tokensPerSecond ? ` · ${row.tokensPerSecond.toFixed(1)} tok/s` : ""}
        </p>
      </div>
      <div className="performance-stage-bar" aria-hidden="true">
        {segments.map((segment) => (
          <span
            key={segment.label}
            style={{
              width: `${Math.max((segment.value / total) * 100, segment.value > 0 ? 4 : 0)}%`,
              background: segment.color,
            }}
          />
        ))}
      </div>
      <div className="performance-stage-metrics">
        {segments.map((segment) => (
          <span key={segment.label}>
            {segment.label}: {formatDurationMs(segment.value)}
          </span>
        ))}
      </div>
    </div>
  );
}


function formatDelta(current: number, previous: number, unit: "ms" | "pp") {
  if (previous <= 0) {
    return "No prior matching window";
  }
  const delta = current - previous;
  const sign = delta > 0 ? "+" : "";
  if (unit === "pp") {
    return `${sign}${delta.toFixed(1)} pp vs previous window`;
  }
  return `${sign}${Math.round(delta)} ms vs previous window`;
}
