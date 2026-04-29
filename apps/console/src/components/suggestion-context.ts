import { normalizeRetrievedProjectTasks } from "@/lib/retrieved-project-tasks";
import type { RetrievedProjectTask, SuggestionRow } from "@/lib/types";

export type PersistedSuggestionContext = {
  request: {
    sessionId: string;
    buffer: string;
    cwd: string;
    repoRoot: string;
    branch: string;
    lastExitCode: number;
    strategy: string;
  };
  modelName: string;
  historyTrusted: boolean;
  recentCommands: string[];
  lastContext: {
    cwd: string;
    repoRoot: string;
    branch: string;
    exitCode: number;
    command: string;
    stdoutExcerpt: string;
    stderrExcerpt: string;
  };
  lastCommandContext: Array<{
    command: string;
    exitCode: number;
    stdoutExcerpt: string;
    stderrExcerpt: string;
    cwd: string;
    repoRoot: string;
    branch: string;
    finishedAtMs: number;
  }>;
  recentOutputContext: Array<{
    command: string;
    exitCode: number;
    stdoutExcerpt: string;
    stderrExcerpt: string;
    finishedAtMs: number;
    score: number;
  }>;
  retrievedContext: {
    currentToken: string;
    historyMatches: string[];
    pathMatches: string[];
    gitBranchMatches: string[];
    projectTasks: RetrievedProjectTask[];
    projectTaskMatches: RetrievedProjectTask[];
  };
};

export type SuggestionContextSnapshot = {
  structuredContext: PersistedSuggestionContext;
  contextPayload: {
    prompt: string;
    structuredContext: PersistedSuggestionContext;
    feedback: {
      outcome: string;
      outcomeEventType: string;
      acceptedCommand: string;
      actualCommand: string;
    };
  };
  replayHref: string;
  summaryTitle: string;
  summarySubtitle: string;
};

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry || "")).filter(Boolean) : [];
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function normalizeLastCommandContext(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as PersistedSuggestionContext["lastCommandContext"];
  }

  return value.map((entry) => {
    const row = recordValue(entry);
    return {
      command: String(pickValue(row, "command", "Command") || ""),
      exitCode: normalizeNumber(pickValue(row, "exitCode", "exit_code", "ExitCode")),
      stdoutExcerpt: String(pickValue(row, "stdoutExcerpt", "stdout_excerpt", "StdoutExcerpt") || ""),
      stderrExcerpt: String(pickValue(row, "stderrExcerpt", "stderr_excerpt", "StderrExcerpt") || ""),
      cwd: String(pickValue(row, "cwd", "CWD") || ""),
      repoRoot: String(pickValue(row, "repoRoot", "repo_root", "RepoRoot") || ""),
      branch: String(pickValue(row, "branch", "Branch") || ""),
      finishedAtMs: normalizeNumber(pickValue(row, "finishedAtMs", "finished_at_ms", "FinishedAtMS")),
    };
  });
}

function normalizeRecentOutputContext(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as PersistedSuggestionContext["recentOutputContext"];
  }

  return value.map((entry) => {
    const row = recordValue(entry);
    return {
      command: String(pickValue(row, "command", "Command") || ""),
      exitCode: normalizeNumber(pickValue(row, "exitCode", "exit_code", "ExitCode")),
      stdoutExcerpt: String(pickValue(row, "stdoutExcerpt", "stdout_excerpt", "StdoutExcerpt") || ""),
      stderrExcerpt: String(pickValue(row, "stderrExcerpt", "stderr_excerpt", "StderrExcerpt") || ""),
      finishedAtMs: normalizeNumber(pickValue(row, "finishedAtMs", "finished_at_ms", "FinishedAtMS")),
      score: normalizeNumber(pickValue(row, "score", "Score")),
    };
  });
}

function shortPath(value: string) {
  if (!value) {
    return "";
  }
  const parts = value.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || value;
}

export function buildSuggestionContextSnapshot(row: SuggestionRow): SuggestionContextSnapshot {
  const fallback: PersistedSuggestionContext = {
    request: {
      sessionId: row.sessionId || "",
      buffer: row.buffer || "",
      cwd: row.cwd || "",
      repoRoot: row.repoRoot || "",
      branch: row.branch || "",
      lastExitCode: row.lastExitCode,
      strategy: "",
    },
    modelName: row.requestModelName || row.modelName || "",
    historyTrusted: false,
    recentCommands: [],
    lastContext: {
      cwd: row.cwd || "",
      repoRoot: row.repoRoot || "",
      branch: row.branch || "",
      exitCode: row.lastExitCode,
      command: "",
      stdoutExcerpt: "",
      stderrExcerpt: "",
    },
    lastCommandContext: [],
    recentOutputContext: [],
    retrievedContext: {
      currentToken: "",
      historyMatches: [],
      pathMatches: [],
      gitBranchMatches: [],
      projectTasks: [],
      projectTaskMatches: [],
    },
  };

  let structuredContext = fallback;
  if (row.structuredContextJson.trim()) {
    try {
      const parsed = JSON.parse(row.structuredContextJson) as Record<string, unknown>;
      const request = recordValue(parsed.request);
      const lastContext = recordValue(parsed.lastContext || parsed.last_context);
      const lastCommandContext = normalizeLastCommandContext(parsed.lastCommandContext || parsed.last_command_context);
      const recentOutputContext = normalizeRecentOutputContext(parsed.recentOutputContext || parsed.recent_output_context);
      const retrievedContext = recordValue(parsed.retrievedContext || parsed.retrieved_context);

      structuredContext = {
        request: {
          sessionId: String(pickValue(request, "sessionId", "session_id") || fallback.request.sessionId),
          buffer: String(pickValue(request, "buffer") || fallback.request.buffer),
          cwd: String(pickValue(request, "cwd", "CWD") || fallback.request.cwd),
          repoRoot: String(pickValue(request, "repoRoot", "repo_root", "RepoRoot") || fallback.request.repoRoot),
          branch: String(pickValue(request, "branch", "Branch") || fallback.request.branch),
          lastExitCode: normalizeNumber(pickValue(request, "lastExitCode", "last_exit_code", "LastExitCode")) || fallback.request.lastExitCode,
          strategy: String(pickValue(request, "strategy") || ""),
        },
        modelName: String(parsed.modelName || parsed.model_name || fallback.modelName),
        historyTrusted: Boolean(parsed.historyTrusted || parsed.history_trusted),
        recentCommands: normalizeStringArray(parsed.recentCommands || parsed.recent_commands),
        lastContext: {
          cwd: String(pickValue(lastContext, "cwd", "CWD") || fallback.lastContext.cwd),
          repoRoot: String(pickValue(lastContext, "repoRoot", "repo_root", "RepoRoot") || fallback.lastContext.repoRoot),
          branch: String(pickValue(lastContext, "branch", "Branch") || fallback.lastContext.branch),
          exitCode: normalizeNumber(pickValue(lastContext, "exitCode", "exit_code", "ExitCode")) || fallback.lastContext.exitCode,
          command: String(pickValue(lastContext, "command", "Command") || ""),
          stdoutExcerpt: String(pickValue(lastContext, "stdoutExcerpt", "stdout_excerpt", "StdoutExcerpt") || ""),
          stderrExcerpt: String(pickValue(lastContext, "stderrExcerpt", "stderr_excerpt", "StderrExcerpt") || ""),
        },
        lastCommandContext:
          lastCommandContext.length > 0
            ? lastCommandContext
            : String(pickValue(lastContext, "command", "Command") || "") ||
                String(pickValue(lastContext, "stdoutExcerpt", "stdout_excerpt", "StdoutExcerpt") || "") ||
                String(pickValue(lastContext, "stderrExcerpt", "stderr_excerpt", "StderrExcerpt") || "")
              ? [{
                  command: String(pickValue(lastContext, "command", "Command") || ""),
                  exitCode: normalizeNumber(pickValue(lastContext, "exitCode", "exit_code", "ExitCode")) || fallback.lastContext.exitCode,
                  stdoutExcerpt: String(pickValue(lastContext, "stdoutExcerpt", "stdout_excerpt", "StdoutExcerpt") || ""),
                  stderrExcerpt: String(pickValue(lastContext, "stderrExcerpt", "stderr_excerpt", "StderrExcerpt") || ""),
                  cwd: String(pickValue(lastContext, "cwd", "CWD") || fallback.lastContext.cwd),
                  repoRoot: String(pickValue(lastContext, "repoRoot", "repo_root", "RepoRoot") || fallback.lastContext.repoRoot),
                  branch: String(pickValue(lastContext, "branch", "Branch") || fallback.lastContext.branch),
                  finishedAtMs: 0,
                }]
              : [],
        recentOutputContext: recentOutputContext,
        retrievedContext: {
          currentToken: String(pickValue(retrievedContext, "currentToken", "current_token") || ""),
          historyMatches: normalizeStringArray(pickValue(retrievedContext, "historyMatches", "history_matches")),
          pathMatches: normalizeStringArray(pickValue(retrievedContext, "pathMatches", "path_matches")),
          gitBranchMatches: normalizeStringArray(pickValue(retrievedContext, "gitBranchMatches", "git_branch_matches")),
          projectTasks: normalizeRetrievedProjectTasks(pickValue(retrievedContext, "projectTasks", "project_tasks")),
          projectTaskMatches: normalizeRetrievedProjectTasks(pickValue(retrievedContext, "projectTaskMatches", "project_task_matches")),
        },
      };
    } catch {
      structuredContext = fallback;
    }
  }

  const contextPayload = {
    prompt: row.promptText || "",
    structuredContext,
    feedback: {
      outcome: row.outcome,
      outcomeEventType: row.outcomeEventType || "",
      acceptedCommand: row.acceptedCommand || "",
      actualCommand: row.actualCommand || "",
    },
  };

  const params = new URLSearchParams();
  if (structuredContext.request.sessionId) {
    params.set("session", structuredContext.request.sessionId);
  }
  if (structuredContext.request.buffer) {
    params.set("buffer", structuredContext.request.buffer);
  }
  if (structuredContext.request.cwd) {
    params.set("cwd", structuredContext.request.cwd);
  }
  if (structuredContext.request.repoRoot) {
    params.set("repo", structuredContext.request.repoRoot);
  }
  if (structuredContext.request.branch) {
    params.set("branch", structuredContext.request.branch);
  }
  params.set("lastExitCode", String(structuredContext.request.lastExitCode));
  if (structuredContext.modelName) {
    params.set("model", structuredContext.modelName);
  }
  if (structuredContext.request.strategy) {
    params.set("strategy", structuredContext.request.strategy);
  }
  if (structuredContext.recentCommands.length > 0) {
    params.set("recentCommands", structuredContext.recentCommands.join("\n"));
  }
  params.set("auto", "1");

  const summaryTitle =
    row.acceptedCommand ||
    row.actualCommand ||
    structuredContext.lastContext.command ||
    structuredContext.request.buffer ||
    shortPath(structuredContext.request.cwd) ||
    "View Context";

  const summarySubtitle = [
    structuredContext.recentCommands.length > 0
      ? `${structuredContext.recentCommands.length} recent`
      : "",
    structuredContext.retrievedContext.projectTasks.length > 0
      ? `${structuredContext.retrievedContext.projectTasks.length} commands`
      : "",
    structuredContext.retrievedContext.historyMatches.length > 0
      ? `${structuredContext.retrievedContext.historyMatches.length} history`
      : "",
    structuredContext.lastCommandContext.length > 0
      ? `${structuredContext.lastCommandContext.length} context`
      : "",
    structuredContext.request.branch || shortPath(structuredContext.request.cwd),
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    structuredContext,
    contextPayload,
    replayHref: `/inspector?${params.toString()}`,
    summaryTitle,
    summarySubtitle,
  };
}
