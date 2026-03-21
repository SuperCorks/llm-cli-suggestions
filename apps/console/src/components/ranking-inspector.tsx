"use client";

import { useMemo, useState } from "react";

import { formatDurationMs } from "@/lib/format";
import { normalizeSuggestStrategy, type SuggestStrategy } from "@/lib/suggest-strategy";
import { SuggestStrategyField } from "@/components/suggest-strategy-field";

type InspectCandidate = {
  command: string;
  source: string;
  score: number;
  latency_ms: number;
  history_score: number;
  accepted_count: number;
  rejected_count: number;
  breakdown: {
    history: number;
    model: number;
    feedback: number;
    recent_usage: number;
    last_context: number;
    total: number;
  };
};

type InspectResponse = {
  model_name: string;
  history_trusted: boolean;
  prompt: string;
  raw_model_output: string;
  cleaned_model_output: string;
  recent_commands: string[];
  last_command: string;
  last_stdout_excerpt: string;
  last_stderr_excerpt: string;
  winner: InspectCandidate | null;
  candidates: InspectCandidate[];
};

type InspectResponsePayload = Partial<InspectResponse> & { error?: string };

function normalizeInspectResponse(input: InspectResponsePayload): InspectResponse {
  return {
    model_name: input.model_name || "",
    history_trusted: Boolean(input.history_trusted),
    prompt: input.prompt || "",
    raw_model_output: input.raw_model_output || "",
    cleaned_model_output: input.cleaned_model_output || "",
    recent_commands: Array.isArray(input.recent_commands) ? input.recent_commands : [],
    last_command: input.last_command || "",
    last_stdout_excerpt: input.last_stdout_excerpt || "",
    last_stderr_excerpt: input.last_stderr_excerpt || "",
    winner: input.winner || null,
    candidates: Array.isArray(input.candidates) ? input.candidates : [],
  };
}

interface RankingInspectorProps {
  defaultModelName: string;
  defaultModelBaseUrl: string;
  defaultSuggestStrategy: SuggestStrategy;
}

export function RankingInspector({
  defaultModelName,
  defaultModelBaseUrl,
  defaultSuggestStrategy,
}: RankingInspectorProps) {
  const [form, setForm] = useState({
    sessionId: "console-ranking",
    buffer: "git st",
    cwd: "",
    repoRoot: "",
    branch: "",
    lastExitCode: "0",
    modelName: defaultModelName,
    modelBaseUrl: defaultModelBaseUrl,
    suggestStrategy: defaultSuggestStrategy,
    recentCommands: "",
  });
  const [response, setResponse] = useState<InspectResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const canInspect = form.buffer.trim().length > 0 && !loading;

  const parsedRecentCommands = useMemo(
    () =>
      form.recentCommands
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
    [form.recentCommands],
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResponse(null);
    try {
      const res = await fetch("/api/ranking", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: form.sessionId,
          buffer: form.buffer,
          cwd: form.cwd,
          repo_root: form.repoRoot,
          branch: form.branch,
          last_exit_code: Number.parseInt(form.lastExitCode || "0", 10) || 0,
          model_name: form.modelName,
          model_base_url: form.modelBaseUrl,
          strategy: form.suggestStrategy,
          recent_commands: parsedRecentCommands,
          limit: 8,
        }),
      });
      const data = (await res.json()) as InspectResponsePayload;
      if (!res.ok) {
        throw new Error(data.error || "ranking request failed");
      }
      setResponse(normalizeInspectResponse(data));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "ranking request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack-lg">
      <form className="stack-md" onSubmit={onSubmit}>
        <div className="form-grid">
          <label>
            Buffer
            <input
              value={form.buffer}
              onChange={(event) => setForm((current) => ({ ...current, buffer: event.target.value }))}
              placeholder="git st"
            />
          </label>
          <label>
            Session ID
            <input
              value={form.sessionId}
              onChange={(event) =>
                setForm((current) => ({ ...current, sessionId: event.target.value }))
              }
              placeholder="console-ranking"
            />
          </label>
          <label>
            CWD
            <input
              value={form.cwd}
              onChange={(event) => setForm((current) => ({ ...current, cwd: event.target.value }))}
              placeholder="/Users/simon/project"
            />
          </label>
          <label>
            Repo Root
            <input
              value={form.repoRoot}
              onChange={(event) =>
                setForm((current) => ({ ...current, repoRoot: event.target.value }))
              }
              placeholder="/Users/simon/project"
            />
          </label>
          <label>
            Branch
            <input
              value={form.branch}
              onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}
              placeholder="main"
            />
          </label>
          <label>
            Last Exit Code
            <input
              value={form.lastExitCode}
              onChange={(event) =>
                setForm((current) => ({ ...current, lastExitCode: event.target.value }))
              }
              placeholder="0"
            />
          </label>
          <label>
            Model
            <input
              value={form.modelName}
              onChange={(event) =>
                setForm((current) => ({ ...current, modelName: event.target.value }))
              }
              placeholder={defaultModelName}
            />
          </label>
          <SuggestStrategyField
            value={normalizeSuggestStrategy(form.suggestStrategy)}
            onChange={(value) =>
              setForm((current) => ({ ...current, suggestStrategy: value }))
            }
          />
          <label>
            Model Base URL
            <input
              value={form.modelBaseUrl}
              onChange={(event) =>
                setForm((current) => ({ ...current, modelBaseUrl: event.target.value }))
              }
              placeholder={defaultModelBaseUrl}
            />
          </label>
        </div>
        <label>
          Recent Commands
          <textarea
            value={form.recentCommands}
            onChange={(event) =>
              setForm((current) => ({ ...current, recentCommands: event.target.value }))
            }
            placeholder={"git status\npnpm test\nnpm run dev"}
            rows={5}
          />
        </label>
        <div className="inline-actions">
          <button type="submit" disabled={!canInspect}>
            {loading ? "Inspecting..." : "Inspect Ranking"}
          </button>
          {!canInspect ? <p className="helper-text">Buffer is required.</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </form>

      {response ? (
        <div className="stack-lg">
          <div className="hero-card">
            <div className="hero-card-topline">Winning candidate</div>
            <h3>{response.winner?.command || "No suggestion"}</h3>
            <p>
              Model: <code>{response.model_name}</code> · History trusted:{" "}
              <strong>{response.history_trusted ? "yes" : "no"}</strong>
            </p>
          </div>

          <div className="detail-block">
            <h3>Candidate Scores</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>Source</th>
                    <th>Total</th>
                    <th>History</th>
                    <th>Model</th>
                    <th>Feedback</th>
                    <th>Recent</th>
                    <th>Last Context</th>
                    <th>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {response.candidates.map((candidate) => (
                    <tr key={`${candidate.command}-${candidate.source}`}>
                      <td>
                        <code>{candidate.command}</code>
                      </td>
                      <td>{candidate.source}</td>
                      <td>{candidate.score}</td>
                      <td>{candidate.breakdown.history}</td>
                      <td>{candidate.breakdown.model}</td>
                      <td>{candidate.breakdown.feedback}</td>
                      <td>{candidate.breakdown.recent_usage}</td>
                      <td>{candidate.breakdown.last_context}</td>
                      <td>{formatDurationMs(candidate.latency_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid two-up">
            <div className="detail-block">
              <h3>Prompt Context</h3>
              <dl className="meta-list">
                <div>
                  <dt>Last command</dt>
                  <dd>{response.last_command || "n/a"}</dd>
                </div>
                <div>
                  <dt>Recent commands</dt>
                  <dd>{response.recent_commands.length || 0}</dd>
                </div>
                <div>
                  <dt>Cleaned model output</dt>
                  <dd>{response.cleaned_model_output || "n/a"}</dd>
                </div>
              </dl>
            </div>
            <div className="detail-block">
              <h3>Model Output</h3>
              <pre className="code-block">{response.raw_model_output || "No raw model output."}</pre>
            </div>
          </div>

          <div className="detail-block">
            <h3>Prompt</h3>
            <pre className="code-block code-block-tall">{response.prompt || "No prompt generated."}</pre>
          </div>

          {response.last_stdout_excerpt || response.last_stderr_excerpt ? (
            <div className="grid two-up">
              <div className="detail-block">
                <h3>Last Stdout Excerpt</h3>
                <pre className="code-block">{response.last_stdout_excerpt || "n/a"}</pre>
              </div>
              <div className="detail-block">
                <h3>Last Stderr Excerpt</h3>
                <pre className="code-block">{response.last_stderr_excerpt || "n/a"}</pre>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
