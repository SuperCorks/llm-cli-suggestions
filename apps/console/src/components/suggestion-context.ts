import type { SuggestionRow } from "@/lib/types";

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
  retrievedContext: {
    currentToken: string;
    historyMatches: string[];
    pathMatches: string[];
    gitBranchMatches: string[];
    projectTasks: string[];
    projectTaskMatches: string[];
  };
};

export type SuggestionContextSnapshot = {
  structuredContext: PersistedSuggestionContext;
  contextPayload: {
    prompt: string;
    structuredContext: PersistedSuggestionContext;
    feedback: {
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
    modelName: row.modelName || "",
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
      const request = (parsed.request as Record<string, unknown> | undefined) || {};
      const lastContext = (parsed.lastContext as Record<string, unknown> | undefined) || {};
      const retrievedContext =
        (parsed.retrievedContext as Record<string, unknown> | undefined) || {};

      structuredContext = {
        request: {
          sessionId: String(request.sessionId || fallback.request.sessionId),
          buffer: String(request.buffer || fallback.request.buffer),
          cwd: String(request.cwd || fallback.request.cwd),
          repoRoot: String(request.repoRoot || fallback.request.repoRoot),
          branch: String(request.branch || fallback.request.branch),
          lastExitCode:
            typeof request.lastExitCode === "number"
              ? request.lastExitCode
              : fallback.request.lastExitCode,
          strategy: String(request.strategy || ""),
        },
        modelName: String(parsed.modelName || fallback.modelName),
        historyTrusted: Boolean(parsed.historyTrusted),
        recentCommands: normalizeStringArray(parsed.recentCommands),
        lastContext: {
          cwd: String(lastContext.cwd || fallback.lastContext.cwd),
          repoRoot: String(lastContext.repoRoot || fallback.lastContext.repoRoot),
          branch: String(lastContext.branch || fallback.lastContext.branch),
          exitCode:
            typeof lastContext.exitCode === "number"
              ? lastContext.exitCode
              : fallback.lastContext.exitCode,
          command: String(lastContext.command || ""),
          stdoutExcerpt: String(lastContext.stdoutExcerpt || ""),
          stderrExcerpt: String(lastContext.stderrExcerpt || ""),
        },
        retrievedContext: {
          currentToken: String(retrievedContext.currentToken || ""),
          historyMatches: normalizeStringArray(retrievedContext.historyMatches),
          pathMatches: normalizeStringArray(retrievedContext.pathMatches),
          gitBranchMatches: normalizeStringArray(retrievedContext.gitBranchMatches),
          projectTasks: normalizeStringArray(retrievedContext.projectTasks),
          projectTaskMatches: normalizeStringArray(retrievedContext.projectTaskMatches),
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
      ? `${structuredContext.retrievedContext.projectTasks.length} tasks`
      : "",
    structuredContext.retrievedContext.historyMatches.length > 0
      ? `${structuredContext.retrievedContext.historyMatches.length} history`
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