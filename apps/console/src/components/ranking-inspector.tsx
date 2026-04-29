"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { PathHoverActions } from "@/components/path-hover-actions";
import { formatDurationMs } from "@/lib/format";
import {
  formatRetrievedProjectTasks,
  normalizeRetrievedProjectTasks,
} from "@/lib/retrieved-project-tasks";
import {
  normalizeSuggestStrategy,
  type SuggestStrategy,
} from "@/lib/suggest-strategy";
import { SuggestStrategyField } from "@/components/suggest-strategy-field";
import type { OllamaModelOption, RetrievedProjectTask } from "@/lib/types";

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
  model_error: string;
  prompt: string;
  raw_model_output: string;
  cleaned_model_output: string;
  recent_commands: string[];
  last_command: string;
  last_stdout_excerpt: string;
  last_stderr_excerpt: string;
  last_command_context: Array<{
    command: string;
    exit_code: number;
    stdout_excerpt: string;
    stderr_excerpt: string;
    cwd: string;
    repo_root: string;
    branch: string;
    finished_at_ms: number;
  }>;
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
    project_tasks: RetrievedProjectTask[];
    project_task_matches: RetrievedProjectTask[];
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
  fastModelName: string;
  modelName: string;
  suggestStrategy: SuggestStrategy;
  recentCommands: string;
};

type RejectedModelOutput = {
  message: string;
  rawOutput: string;
};

type InspectStageResult = {
  key: string;
  label: string;
  modelName: string;
  response: InspectResponse | null;
  skippedReason?: string;
  errorReason?: string;
};

type InspectStageDefinition = {
  key: string;
  label: string;
  strategy: string;
  modelName: string;
  skippedReason?: string;
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
    model_error: input.model_error || "",
    prompt: input.prompt || "",
    raw_model_output: input.raw_model_output || "",
    cleaned_model_output: input.cleaned_model_output || "",
    recent_commands: Array.isArray(input.recent_commands)
      ? input.recent_commands
      : [],
    last_command: input.last_command || "",
    last_stdout_excerpt: input.last_stdout_excerpt || "",
    last_stderr_excerpt: input.last_stderr_excerpt || "",
    last_command_context: Array.isArray(input.last_command_context)
      ? input.last_command_context.map((entry) => ({
          command: entry?.command || "",
          exit_code:
            typeof entry?.exit_code === "number" ? entry.exit_code : 0,
          stdout_excerpt: entry?.stdout_excerpt || "",
          stderr_excerpt: entry?.stderr_excerpt || "",
          cwd: entry?.cwd || "",
          repo_root: entry?.repo_root || "",
          branch: entry?.branch || "",
          finished_at_ms:
            typeof entry?.finished_at_ms === "number"
              ? entry.finished_at_ms
              : 0,
        }))
      : [],
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
      project_tasks: normalizeRetrievedProjectTasks(
        input.retrieved_context?.project_tasks,
      ),
      project_task_matches: normalizeRetrievedProjectTasks(
        input.retrieved_context?.project_task_matches,
      ),
    },
    winner,
    candidates,
  };
}

function describeRejectedModelOutput(
  response: InspectResponse | null,
): RejectedModelOutput | null {
  if (!response || !response.raw_model_output.trim()) {
    return null;
  }

  const rejectedPrefixMismatch =
    response.model_error.includes("did not begin with the current buffer") ||
    (!response.cleaned_model_output && response.raw_model_output.trim().length > 0);
  if (!rejectedPrefixMismatch) {
    return null;
  }

  return {
    message:
      "The model did return output, but the engine rejected it because it did not continue the current buffer exactly, so it would not have been a safe completion.",
    rawOutput: response.raw_model_output,
  };
}

interface RankingInspectorProps {
  defaultModelName: string;
  defaultFastModelName: string;
  defaultSuggestStrategy: SuggestStrategy;
  availableModels: OllamaModelOption[];
  inventorySummary: {
    installedCount: number;
    libraryCount: number;
    installedError?: string;
    libraryError?: string;
  };
  initialForm?: Partial<InspectFormState>;
  autoInspect?: boolean;
}

export function RankingInspector({
  defaultModelName,
  defaultFastModelName,
  defaultSuggestStrategy,
  availableModels,
  inventorySummary,
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
    fastModelName: initialForm?.fastModelName || defaultFastModelName,
    modelName: initialForm?.modelName || defaultModelName,
    suggestStrategy: initialForm?.suggestStrategy || defaultSuggestStrategy,
    recentCommands: initialForm?.recentCommands || "",
  }));
  const [response, setResponse] = useState<InspectResponse | null>(null);
  const [stageResponses, setStageResponses] = useState<InspectStageResult[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const didAutoInspect = useRef(false);
  const canInspect = form.buffer.trim().length > 0 && !loading;
  const rejectedModelOutput = useMemo(
    () => describeRejectedModelOutput(response),
    [response],
  );
  const installedModelHelperText =
    inventorySummary.installedError || inventorySummary.libraryError
      ? [inventorySummary.installedError, inventorySummary.libraryError]
          .filter(Boolean)
          .join(" · ")
      : `${inventorySummary.installedCount} installed locally · ${inventorySummary.libraryCount} available to download`;
  const installedModelEmptyMessage = (
    <>
      No matching installed models. Download additional models from the{" "}
      <Link href="/models">Models</Link> page.
    </>
  );

  const parsedRecentCommands = useMemo(
    () =>
      form.recentCommands
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
    [form.recentCommands],
  );

  const progressiveStages = useMemo(() => {
    if (form.suggestStrategy === "history-then-fast-then-model") {
      return [
        { key: "history", label: "History Suggestion", strategy: "history-only", modelName: "" },
        {
          key: "fast",
          label: "Fast Suggestion",
          strategy: "history+model-always",
          modelName: form.fastModelName.trim() || defaultFastModelName.trim(),
          skippedReason: (form.fastModelName.trim() || defaultFastModelName.trim())
            ? undefined
            : "No fast-stage model is configured in the inspector or daemon settings.",
        },
        {
          key: "slow",
          label: "Slow Suggestion",
          strategy: "history+model-always",
          modelName: form.modelName.trim() || defaultModelName,
        },
      ] satisfies InspectStageDefinition[];
    }

    if (form.suggestStrategy === "fast-then-model") {
      return [
        {
          key: "fast",
          label: "Fast Suggestion",
          strategy: "model-only",
          modelName: form.fastModelName.trim() || defaultFastModelName.trim(),
          skippedReason: (form.fastModelName.trim() || defaultFastModelName.trim())
            ? undefined
            : "No fast-stage model is configured in the inspector or daemon settings.",
        },
        {
          key: "slow",
          label: "Slow Suggestion",
          strategy: "model-only",
          modelName: form.modelName.trim() || defaultModelName,
        },
      ] satisfies InspectStageDefinition[];
    }

    if (form.suggestStrategy === "history-then-model") {
      return [
        { key: "history", label: "History Suggestion", strategy: "history-only", modelName: "" },
        {
          key: "slow",
          label: "Slow Suggestion",
          strategy: "history+model-always",
          modelName: form.modelName.trim() || defaultModelName,
        },
      ] satisfies InspectStageDefinition[];
    }

    return [] as InspectStageDefinition[];
  }, [
    defaultFastModelName,
    defaultModelName,
    form.fastModelName,
    form.modelName,
    form.suggestStrategy,
  ]);

  const runInspect = useCallback(async () => {
    setLoading(true);
    setError("");
    setResponse(null);
    setStageResponses([]);
    try {
      const parsedLastExitCode = form.lastExitCode.trim()
        ? Number.parseInt(form.lastExitCode, 10)
        : null;

      const basePayload = {
        session_id: form.sessionId.trim(),
        buffer: form.buffer,
        cwd: form.cwd.trim(),
        ...(form.repoRoot.trim() ? { repo_root: form.repoRoot.trim() } : {}),
        ...(form.branch.trim() ? { branch: form.branch.trim() } : {}),
        ...(Number.isFinite(parsedLastExitCode)
          ? { last_exit_code: parsedLastExitCode }
          : {}),
        recent_commands: parsedRecentCommands,
        limit: 8,
      };

      const fetchInspect = async (payload: Record<string, unknown>) => {
        const res = await fetch("/api/ranking", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as InspectResponsePayload;
        if (!res.ok) {
          throw new Error(data.error || "inspect request failed");
        }
        return normalizeInspectResponse(data);
      };

      if (progressiveStages.length > 0) {
        const results = await Promise.all(
          progressiveStages.map(async (stage) => {
            if (stage.skippedReason) {
              return {
                key: stage.key,
                label: stage.label,
                modelName: stage.modelName,
                response: null,
                skippedReason: stage.skippedReason,
              } satisfies InspectStageResult;
            }

            try {
              const stageResponse = await fetchInspect({
                ...basePayload,
                model_name: stage.modelName,
                strategy: stage.strategy,
              });

              return {
                key: stage.key,
                label: stage.label,
                modelName: stage.modelName,
                response: stageResponse,
              } satisfies InspectStageResult;
            } catch (stageError) {
              return {
                key: stage.key,
                label: stage.label,
                modelName: stage.modelName,
                response: null,
                errorReason:
                  stageError instanceof Error
                    ? stageError.message
                    : "inspect request failed",
              } satisfies InspectStageResult;
            }
          }),
        );

        setStageResponses(results);
        const finalStage = [...results]
          .reverse()
          .find((stage) => stage.response)?.response;
        if (finalStage) {
          setResponse(finalStage);
        } else {
          const firstError = results.find((stage) => stage.errorReason)?.errorReason;
          setError(firstError || "inspect request failed");
        }
      } else {
        const data = await fetchInspect({
          ...basePayload,
          model_name: form.modelName,
          strategy: form.suggestStrategy,
        });
        setResponse(data);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "inspect request failed",
      );
    } finally {
      setLoading(false);
    }
  }, [
    form,
    parsedRecentCommands,
    progressiveStages,
  ]);

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
          <div
            className={
              form.suggestStrategy === "history-then-fast-then-model" ||
              form.suggestStrategy === "fast-then-model"
                ? "form-grid-span-2"
                : undefined
            }
          >
            <SuggestStrategyField
              value={normalizeSuggestStrategy(form.suggestStrategy)}
              onChange={(value) =>
                setForm((current) => ({ ...current, suggestStrategy: value }))
              }
            />
          </div>
          {form.suggestStrategy === "history-then-fast-then-model" ||
          form.suggestStrategy === "fast-then-model" ? (
            <>
              <div>
                <ModelPicker
                  mode="single"
                  label="Fast Model"
                  value={form.fastModelName}
                  options={availableModels}
                  installedOnly
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      fastModelName: value,
                    }))
                  }
                  placeholder={defaultFastModelName || "Pick an installed model"}
                  helperText={installedModelHelperText}
                  emptyMessage={installedModelEmptyMessage}
                />
              </div>
              <div>
                <ModelPicker
                  mode="single"
                  label="Slow Model"
                  value={form.modelName}
                  options={availableModels}
                  installedOnly
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      modelName: value,
                    }))
                  }
                  placeholder={defaultModelName || "Pick an installed model"}
                  helperText={installedModelHelperText}
                  emptyMessage={installedModelEmptyMessage}
                />
              </div>
            </>
          ) : (
            <div>
              <ModelPicker
                mode="single"
                label="Model"
                value={form.modelName}
                options={availableModels}
                installedOnly
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    modelName: value,
                  }))
                }
                placeholder={defaultModelName || "Pick an installed model"}
                helperText={installedModelHelperText}
                emptyMessage={installedModelEmptyMessage}
              />
            </div>
          )}
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

      {stageResponses.length > 0 ? (
        <div className="grid three-up">
          {stageResponses.map((stage) => (
            <div key={stage.key} className="detail-block">
              <h3>{stage.label}</h3>
              <p className="helper-text">
                {stage.modelName ? (
                  <>
                    Model: <code>{stage.modelName}</code>
                  </>
                ) : (
                  "History-only stage"
                )}
              </p>
              <pre className="code-block">
                {stage.response?.winner?.command ||
                  stage.errorReason ||
                  stage.skippedReason ||
                  "No suggestion."}
              </pre>
            </div>
          ))}
        </div>
      ) : null}

      {response ? (
        <div className="stack-lg">
          <div className="hero-card">
            <div className="hero-card-topline">Winning candidate</div>
            <h3>{response.winner?.command || "No suggestion"}</h3>
            <p>
              Model: <code>{response.model_name}</code> · History trusted:{" "}
              <strong>{response.history_trusted ? "yes" : "no"}</strong>
            </p>
            {response.model_error ? (
              <p className="error-text">{response.model_error}</p>
            ) : null}
          </div>

          {rejectedModelOutput ? (
            <div className="detail-block">
              <h3>Rejected Raw Model Output</h3>
              <p className="error-text">{rejectedModelOutput.message}</p>
              <div className="grid two-up">
                <div>
                  <p className="helper-text">Current buffer</p>
                  <pre className="code-block">{form.buffer}</pre>
                </div>
                <div>
                  <p className="helper-text">Model output that was rejected</p>
                  <pre className="code-block">{rejectedModelOutput.rawOutput}</pre>
                </div>
              </div>
            </div>
          ) : null}

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
                  <dt>Last command contexts</dt>
                  <dd>{response.last_command_context.length || 0}</dd>
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

          <div className="detail-block">
            <h3>Last Command Context</h3>
            <pre className="code-block">
              {response.last_command_context.length > 0
                ? response.last_command_context
                    .map((entry, index) =>
                      [
                        `${index + 1}. ${entry.command || "n/a"}`,
                        `exit: ${entry.exit_code}`,
                        entry.stdout_excerpt ? `stdout:\n${entry.stdout_excerpt}` : "",
                        entry.stderr_excerpt ? `stderr:\n${entry.stderr_excerpt}` : "",
                      ]
                        .filter(Boolean)
                        .join("\n"),
                    )
                    .join("\n\n")
                : "No last command context."}
            </pre>
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
                  <dt>Project commands</dt>
                  <dd>{response.retrieved_context.project_tasks.length}</dd>
                </div>
                <div>
                  <dt>Project command matches</dt>
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
                    ? `project commands:\n${formatRetrievedProjectTasks(response.retrieved_context.project_tasks)}`
                    : "",
                  response.retrieved_context.project_task_matches.length
                    ? `project command matches:\n${formatRetrievedProjectTasks(response.retrieved_context.project_task_matches)}`
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
