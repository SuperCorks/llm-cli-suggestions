"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PathHoverActions } from "@/components/path-hover-actions";
import { formatDurationMs } from "@/lib/format";
import {
  normalizeSuggestStrategy,
  type SuggestStrategy,
} from "@/lib/suggest-strategy";
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
    retrieval: number;
    model: number;
    feedback: number;
    recent_usage: number;
    last_context: number;
    output_context: number;
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
  recent_output_context: Array<{
    command: string;
    exit_code: number;
    stdout_excerpt: string;
    stderr_excerpt: string;
    finished_at_ms: number;
    score: number;
  }>;
  retrieved_context: {
    current_token: string;
    history_matches: string[];
    path_matches: string[];
    git_branch_matches: string[];
    project_tasks: string[];
    project_task_matches: string[];
  };
  winner: InspectCandidate | null;
  candidates: InspectCandidate[];
};

type InspectResponsePayload = Partial<InspectResponse> & { error?: string };

type InspectFormState = {
  sessionId: string;
  buffer: string;
  cwd: string;
  repoRoot: string;
  branch: string;
  lastExitCode: string;
  modelName: string;
  suggestStrategy: SuggestStrategy;
  recentCommands: string;
};

function normalizeCandidate(
  input: Partial<InspectCandidate> | null | undefined,
): InspectCandidate | null {
  if (!input || !input.command || !input.source) {
    return null;
  }
  return {
    command: input.command,
    source: input.source,
    score: typeof input.score === "number" ? input.score : 0,
    latency_ms: typeof input.latency_ms === "number" ? input.latency_ms : 0,
    history_score:
      typeof input.history_score === "number" ? input.history_score : 0,
    accepted_count:
      typeof input.accepted_count === "number" ? input.accepted_count : 0,
    rejected_count:
      typeof input.rejected_count === "number" ? input.rejected_count : 0,
    breakdown: {
      history:
        typeof input.breakdown?.history === "number"
          ? input.breakdown.history
          : 0,
      retrieval:
        typeof input.breakdown?.retrieval === "number"
          ? input.breakdown.retrieval
          : 0,
      model:
        typeof input.breakdown?.model === "number" ? input.breakdown.model : 0,
      feedback:
        typeof input.breakdown?.feedback === "number"
          ? input.breakdown.feedback
          : 0,
      recent_usage:
        typeof input.breakdown?.recent_usage === "number"
          ? input.breakdown.recent_usage
          : 0,
      last_context:
        typeof input.breakdown?.last_context === "number"
          ? input.breakdown.last_context
          : 0,
      output_context:
        typeof input.breakdown?.output_context === "number"
          ? input.breakdown.output_context
          : 0,
      total:
        typeof input.breakdown?.total === "number" ? input.breakdown.total : 0,
    },
  };
}

function normalizeInspectResponse(
  input: InspectResponsePayload,
): InspectResponse {
  const winner = normalizeCandidate(input.winner);
  const candidates = Array.isArray(input.candidates)
    ? input.candidates
        .map((candidate) => normalizeCandidate(candidate))
        .filter((candidate): candidate is InspectCandidate =>
          Boolean(candidate),
        )
    : [];
  return {
    model_name: input.model_name || "",
    history_trusted: Boolean(input.history_trusted),
    prompt: input.prompt || "",
    raw_model_output: input.raw_model_output || "",
    cleaned_model_output: input.cleaned_model_output || "",
    recent_commands: Array.isArray(input.recent_commands)
      ? input.recent_commands
      : [],
    last_command: input.last_command || "",
    last_stdout_excerpt: input.last_stdout_excerpt || "",
    last_stderr_excerpt: input.last_stderr_excerpt || "",
    recent_output_context: Array.isArray(input.recent_output_context)
      ? input.recent_output_context.map((entry) => ({
          command: entry?.command || "",
          exit_code:
            typeof entry?.exit_code === "number" ? entry.exit_code : 0,
          stdout_excerpt: entry?.stdout_excerpt || "",
          stderr_excerpt: entry?.stderr_excerpt || "",
          finished_at_ms:
            typeof entry?.finished_at_ms === "number"
              ? entry.finished_at_ms
              : 0,
          score: typeof entry?.score === "number" ? entry.score : 0,
        }))
      : [],
    retrieved_context: {
      current_token: input.retrieved_context?.current_token || "",
      history_matches: Array.isArray(input.retrieved_context?.history_matches)
        ? input.retrieved_context?.history_matches
        : [],
      path_matches: Array.isArray(input.retrieved_context?.path_matches)
        ? input.retrieved_context?.path_matches
        : [],
      git_branch_matches: Array.isArray(
        input.retrieved_context?.git_branch_matches,
      )
        ? input.retrieved_context?.git_branch_matches
        : [],
      project_tasks: Array.isArray(input.retrieved_context?.project_tasks)
        ? input.retrieved_context?.project_tasks
        : [],
      project_task_matches: Array.isArray(
        input.retrieved_context?.project_task_matches,
      )
        ? input.retrieved_context?.project_task_matches
        : [],
    },
    winner,
    candidates,
  };
}

interface RankingInspectorProps {
  defaultModelName: string;
  defaultSuggestStrategy: SuggestStrategy;
  initialForm?: Partial<InspectFormState>;
  autoInspect?: boolean;
}

export function RankingInspector({
  defaultModelName,
  defaultSuggestStrategy,
  initialForm,
  autoInspect = false,
}: RankingInspectorProps) {
  const [form, setForm] = useState<InspectFormState>(() => ({
    sessionId: initialForm?.sessionId || "",
    buffer: initialForm?.buffer || "git st",
    cwd: initialForm?.cwd || "",
    repoRoot: initialForm?.repoRoot || "",
    branch: initialForm?.branch || "",
    lastExitCode: initialForm?.lastExitCode || "",
    modelName: initialForm?.modelName || defaultModelName,
    suggestStrategy: initialForm?.suggestStrategy || defaultSuggestStrategy,
    recentCommands: initialForm?.recentCommands || "",
  }));
  const [response, setResponse] = useState<InspectResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const didAutoInspect = useRef(false);
  const canInspect = form.buffer.trim().length > 0 && !loading;

  const parsedRecentCommands = useMemo(
    () =>
      form.recentCommands
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
    [form.recentCommands],
  );

  const runInspect = useCallback(async () => {
    setLoading(true);
    setError("");
    setResponse(null);
    try {
      const parsedLastExitCode = form.lastExitCode.trim()
        ? Number.parseInt(form.lastExitCode, 10)
        : null;
      const res = await fetch("/api/ranking", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: form.sessionId.trim(),
          buffer: form.buffer,
          cwd: form.cwd.trim(),
          ...(form.repoRoot.trim() ? { repo_root: form.repoRoot.trim() } : {}),
          ...(form.branch.trim() ? { branch: form.branch.trim() } : {}),
          ...(Number.isFinite(parsedLastExitCode)
            ? { last_exit_code: parsedLastExitCode }
            : {}),
          model_name: form.modelName,
          strategy: form.suggestStrategy,
          recent_commands: parsedRecentCommands,
          limit: 8,
        }),
      });
      const data = (await res.json()) as InspectResponsePayload;
      if (!res.ok) {
        throw new Error(data.error || "inspect request failed");
      }
      setResponse(normalizeInspectResponse(data));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "inspect request failed",
      );
    } finally {
      setLoading(false);
    }
  }, [form, parsedRecentCommands]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runInspect();
  }

  useEffect(() => {
    if (!autoInspect || didAutoInspect.current || form.buffer.trim().length === 0) {
      return;
    }
    didAutoInspect.current = true;
    void runInspect();
  }, [autoInspect, form.buffer, runInspect]);

  return (
    <div className="stack-lg">
      <form className="stack-md" onSubmit={onSubmit}>
        <div className="form-grid">
          <label>
            Buffer
            <input
              value={form.buffer}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  buffer: event.target.value,
                }))
              }
              placeholder="git st"
            />
          </label>
          <label>
            Session ID
            <input
              value={form.sessionId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  sessionId: event.target.value,
                }))
              }
              placeholder="console-ranking"
            />
          </label>
          <label>
            CWD
            <PathHoverActions pathValue={form.cwd} label="Inspector CWD" variant="input">
              <input
                value={form.cwd}
                onChange={(event) =>
                  setForm((current) => ({ ...current, cwd: event.target.value }))
                }
                placeholder="/Users/simon/project"
              />
            </PathHoverActions>
          </label>
          <label>
            Repo Root
            <PathHoverActions pathValue={form.repoRoot} label="Inspector repo root" variant="input">
              <input
                value={form.repoRoot}
                onChange={(event) =>
                  setForm((current) => ({ ...current, repoRoot: event.target.value }))
                }
                placeholder="/Users/simon/project"
              />
            </PathHoverActions>
          </label>
          <label>
            Branch
            <input
              value={form.branch}
              onChange={(event) =>
                setForm((current) => ({ ...current, branch: event.target.value }))
              }
              placeholder="main"
            />
          </label>
          <label>
            Last Exit Code
            <input
              value={form.lastExitCode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  lastExitCode: event.target.value,
                }))
              }
              placeholder="0"
            />
          </label>
          <label>
            Model
            <input
              value={form.modelName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  modelName: event.target.value,
                }))
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
        </div>
        <p className="helper-text">
          Leave <code>Session ID</code> empty to inspect from the current form
          inputs only. When you provide a session or a working directory, the
          engine can infer repo root, branch, and recent command context
          automatically, but replay links can also pin those fields directly.
        </p>
        <label>
          Recent Commands
          <textarea
            value={form.recentCommands}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                recentCommands: event.target.value,
              }))
            }
            placeholder={"git status\npnpm test\nnpm run dev"}
            rows={5}
          />
        </label>
        <div className="inline-actions">
          <button type="submit" disabled={!canInspect}>
            {loading ? "Inspecting..." : "Inspect"}
          </button>
          {!canInspect ? (
            <p className="helper-text">Buffer is required.</p>
          ) : null}
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
                    <th>Retrieval</th>
                    <th>Model</th>
                    <th>Feedback</th>
                    <th>Recent</th>
                    <th>Last Context</th>
                    <th>Output Context</th>
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
                      <td>{candidate.breakdown.retrieval}</td>
                      <td>{candidate.breakdown.model}</td>
                      <td>{candidate.breakdown.feedback}</td>
                      <td>{candidate.breakdown.recent_usage}</td>
                      <td>{candidate.breakdown.last_context}</td>
                      <td>{candidate.breakdown.output_context}</td>
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
                  <dt>Current token</dt>
                  <dd>{response.retrieved_context.current_token || "n/a"}</dd>
                </div>
                <div>
                  <dt>Recent output snippets</dt>
                  <dd>{response.recent_output_context.length || 0}</dd>
                </div>
                <div>
                  <dt>Cleaned model output</dt>
                  <dd>{response.cleaned_model_output || "n/a"}</dd>
                </div>
              </dl>
            </div>
            <div className="detail-block">
              <h3>Model Output</h3>
              <pre className="code-block">
                {response.raw_model_output || "No raw model output."}
              </pre>
            </div>
          </div>

          <div className="grid two-up">
            <div className="detail-block">
              <h3>Retrieved Context</h3>
              <dl className="meta-list">
                <div>
                  <dt>History matches</dt>
                  <dd>{response.retrieved_context.history_matches.length}</dd>
                </div>
                <div>
                  <dt>Path matches</dt>
                  <dd>{response.retrieved_context.path_matches.length}</dd>
                </div>
                <div>
                  <dt>Git branch matches</dt>
                  <dd>
                    {response.retrieved_context.git_branch_matches.length}
                  </dd>
                </div>
                <div>
                  <dt>Project tasks</dt>
                  <dd>{response.retrieved_context.project_tasks.length}</dd>
                </div>
                <div>
                  <dt>Project task matches</dt>
                  <dd>
                    {response.retrieved_context.project_task_matches.length}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="detail-block">
              <h3>Retrieved Values</h3>
              <pre className="code-block">
                {[
                  response.retrieved_context.history_matches.length
                    ? `history:\n- ${response.retrieved_context.history_matches.join("\n- ")}`
                    : "",
                  response.retrieved_context.path_matches.length
                    ? `paths:\n- ${response.retrieved_context.path_matches.join("\n- ")}`
                    : "",
                  response.retrieved_context.git_branch_matches.length
                    ? `branches:\n- ${response.retrieved_context.git_branch_matches.join("\n- ")}`
                    : "",
                  response.retrieved_context.project_tasks.length
                    ? `project tasks:\n- ${response.retrieved_context.project_tasks.join("\n- ")}`
                    : "",
                  response.retrieved_context.project_task_matches.length
                    ? `project task matches:\n- ${response.retrieved_context.project_task_matches.join("\n- ")}`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n\n") || "No retrieved context."}
              </pre>
            </div>
          </div>

          <div className="detail-block">
            <h3>Prompt</h3>
            <pre className="code-block code-block-tall">
              {response.prompt || "No prompt generated."}
            </pre>
          </div>

          {response.last_stdout_excerpt || response.last_stderr_excerpt ? (
            <div className="grid two-up">
              <div className="detail-block">
                <h3>Last Stdout Excerpt</h3>
                <pre className="code-block">
                  {response.last_stdout_excerpt || "n/a"}
                </pre>
              </div>
              <div className="detail-block">
                <h3>Last Stderr Excerpt</h3>
                <pre className="code-block">
                  {response.last_stderr_excerpt || "n/a"}
                </pre>
              </div>
            </div>
          ) : null}

          {response.recent_output_context.length ? (
            <div className="detail-block">
              <h3>Recent Output Context</h3>
              <pre className="code-block">
                {response.recent_output_context
                  .map((entry) =>
                    [
                      `command: ${entry.command}`,
                      `exit_code: ${entry.exit_code}`,
                      `score: ${entry.score}`,
                      entry.stdout_excerpt
                        ? `stdout:\n${entry.stdout_excerpt}`
                        : "",
                      entry.stderr_excerpt
                        ? `stderr:\n${entry.stderr_excerpt}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join("\n"),
                  )
                  .join("\n\n---\n\n")}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
