import { CommandsHistoryShell } from "@/components/commands-history-shell";
import { PathHoverActions } from "@/components/path-hover-actions";
import { Panel } from "@/components/panel";
import { formatPercent, formatTimestamp } from "@/lib/format";
import { getFeedbackSummaryFiltered, listCommands } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

function getString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function CommandsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = Number.parseInt(getString(params.page) || "1", 10) || 1;
  const commands = listCommands({
    page,
    pageSize: 25,
    session: getString(params.session) || undefined,
    cwd: getString(params.cwd) || undefined,
    repo: getString(params.repo) || undefined,
    query: getString(params.query) || undefined,
  });
  const feedback = getFeedbackSummaryFiltered({
    session: getString(params.session) || undefined,
    cwd: getString(params.cwd) || undefined,
    repo: getString(params.repo) || undefined,
    query: getString(params.query) || undefined,
  });

  return (
    <div className="stack-lg">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Operations</span>
          <h1>Commands & Feedback</h1>
          <p>See executed commands, recent feedback events, acceptance rate by path, and rejected trends.</p>
        </div>
      </div>

      <Panel title="Command Filters" subtitle="These filters apply to command history and all feedback summaries on this page.">
        <form className="stack-md" method="get">
          <div className="form-grid">
            <label>
              Query
              <input name="query" defaultValue={getString(params.query)} placeholder="stderr or command text" />
            </label>
            <label>
              Session
              <input name="session" defaultValue={getString(params.session)} />
            </label>
            <label>
              CWD
              <PathHoverActions pathValue={getString(params.cwd)} label="Commands filter cwd" variant="input">
                <input name="cwd" defaultValue={getString(params.cwd)} />
              </PathHoverActions>
            </label>
            <label>
              Repo
              <PathHoverActions pathValue={getString(params.repo)} label="Commands filter repo" variant="input">
                <input name="repo" defaultValue={getString(params.repo)} />
              </PathHoverActions>
            </label>
          </div>
          <div className="inline-actions">
            <button type="submit">Apply Filters</button>
            <a className="button-link" href="/commands">
              Clear
            </a>
          </div>
        </form>
      </Panel>

      <div className="grid two-up">
        <Panel title="Top Rejected Suggestions">
          <ul className="metric-list">
            {feedback.topRejectedSuggestions.map((row) => (
              <li key={row.suggestion}>
                <code>{row.suggestion}</code>
                <strong>{row.count}</strong>
              </li>
            ))}
            {feedback.topRejectedSuggestions.length === 0 ? <li>No rejected suggestions yet.</li> : null}
          </ul>
        </Panel>

        <Panel title="Acceptance By Path">
          <ul className="metric-list">
            {feedback.acceptanceByPath.map((row) => (
              <li key={row.path}>
                {row.path === "(no path)" ? (
                  <span>{row.path}</span>
                ) : (
                  <PathHoverActions pathValue={row.path} label="Feedback path" variant="inline">
                    <span>{row.path}</span>
                  </PathHoverActions>
                )}
                <strong>{formatPercent(row.acceptanceRate)}</strong>
              </li>
            ))}
            {feedback.acceptanceByPath.length === 0 ? <li>No path-level feedback yet.</li> : null}
          </ul>
        </Panel>
      </div>

      <Panel title="Recent Feedback Events" subtitle="Latest suggestion outcome events including buffered, executed, edited, and rejected paths.">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Session</th>
                <th>Event</th>
                <th>Buffer</th>
                <th>Suggestion</th>
                <th>Accepted Command</th>
                <th>Actual Command</th>
              </tr>
            </thead>
            <tbody>
              {feedback.recentFeedback.map((row) => (
                <tr key={row.id}>
                  <td>{formatTimestamp(row.createdAtMs)}</td>
                  <td>
                    <code>{row.sessionId}</code>
                  </td>
                  <td>{row.eventType}</td>
                  <td>
                    <code>{row.buffer}</code>
                  </td>
                  <td>
                    <code>{row.suggestionText}</code>
                  </td>
                  <td>{row.acceptedCommand || "n/a"}</td>
                  <td>{row.actualCommand || "n/a"}</td>
                </tr>
              ))}
              {feedback.recentFeedback.length === 0 ? (
                <tr>
                  <td colSpan={7}>No feedback captured yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Command History"
        subtitle={`Showing ${commands.rows.length} of ${commands.total} commands.`}
      >
        <CommandsHistoryShell rows={commands.rows} />
      </Panel>
    </div>
  );
}
