import { Panel } from "@/components/panel";
import { formatDurationMs, formatTimestamp } from "@/lib/format";
import { listSuggestions } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

function getString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function SuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = Number.parseInt(getString(params.page) || "1", 10) || 1;
  const result = listSuggestions({
    page,
    pageSize: 25,
    source: getString(params.source) || undefined,
    model: getString(params.model) || undefined,
    session: getString(params.session) || undefined,
    cwd: getString(params.cwd) || undefined,
    repo: getString(params.repo) || undefined,
    query: getString(params.query) || undefined,
    outcome: (getString(params.outcome) || "all") as
      | "all"
      | "accepted"
      | "rejected"
      | "unreviewed",
  });

  return (
    <div className="stack-lg">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Explorer</span>
          <h1>Suggestions</h1>
          <p>Inspect generated suggestions, feedback state, latency, and where they came from.</p>
        </div>
      </div>

      <Panel title="Filters" subtitle="Filters are applied server-side against the SQLite database.">
        <form className="stack-md" method="get">
          <div className="form-grid">
            <label>
              Query
              <input name="query" defaultValue={getString(params.query)} placeholder="git status" />
            </label>
            <label>
              Outcome
              <select name="outcome" defaultValue={getString(params.outcome) || "all"}>
                <option value="all">All</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="unreviewed">Unreviewed</option>
              </select>
            </label>
            <label>
              Source
              <input name="source" defaultValue={getString(params.source)} placeholder="history" />
            </label>
            <label>
              Model
              <input
                name="model"
                defaultValue={getString(params.model)}
                placeholder="qwen2.5-coder:7b"
              />
            </label>
            <label>
              Session
              <input name="session" defaultValue={getString(params.session)} />
            </label>
            <label>
              CWD
              <input name="cwd" defaultValue={getString(params.cwd)} />
            </label>
            <label>
              Repo
              <input name="repo" defaultValue={getString(params.repo)} />
            </label>
          </div>
          <div className="inline-actions">
            <button type="submit">Apply Filters</button>
            <a className="button-link" href="/suggestions">
              Clear
            </a>
          </div>
        </form>
      </Panel>

      <Panel
        title="Suggestion History"
        subtitle={`Showing ${result.rows.length} of ${result.total} total suggestions.`}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Buffer</th>
                <th>Suggestion</th>
                <th>Source</th>
                <th>Model</th>
                <th>Latency</th>
                <th>Outcome</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatTimestamp(row.createdAtMs)}</td>
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
                    {row.accepted
                      ? "Accepted"
                      : row.rejected
                        ? "Rejected"
                        : "Unreviewed"}
                  </td>
                  <td className="context-cell">
                    <div>{row.cwd || "n/a"}</div>
                    <div>{row.repoRoot || "n/a"}</div>
                    <div>{row.branch || "n/a"}</div>
                    {row.acceptedCommand ? <div>Accepted: {row.acceptedCommand}</div> : null}
                    {row.actualCommand ? <div>Actual: {row.actualCommand}</div> : null}
                  </td>
                </tr>
              ))}
              {result.rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>No suggestions matched the selected filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
