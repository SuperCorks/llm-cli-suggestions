export type SuggestionOutcome = "all" | "accepted" | "rejected" | "unreviewed";
export type ClearDataset = "suggestions" | "feedback" | "benchmarks";
export type SuggestStrategy = "history-only" | "history+model" | "model-only";

export interface RuntimeSettings {
  stateDir: string;
  runtimeEnvPath: string;
  socketPath: string;
  dbPath: string;
  modelName: string;
  modelBaseUrl: string;
  suggestStrategy: SuggestStrategy;
  suggestTimeoutMs: number;
}

export interface OllamaModelOption {
  name: string;
  installed: boolean;
  source: "installed" | "library";
}

export interface OllamaInstallJob {
  id: string;
  model: string;
  status: "pending" | "running" | "completed" | "failed";
  message: string;
  progressPercent: number;
  completed: number;
  total: number;
  error: string;
  startedAtMs: number;
  updatedAtMs: number;
  finishedAtMs: number;
}

export interface RuntimeStatus {
  health: {
    ok: boolean;
    modelName: string;
    socket: string;
    error?: string;
  };
  settings: RuntimeSettings;
  logPath: string;
  pidPath: string;
  pid: number | null;
}

export interface OverviewData {
  runtime: RuntimeStatus;
  totals: {
    sessions: number;
    commands: number;
    suggestions: number;
    accepted: number;
    rejected: number;
  };
  acceptanceRate: number;
  averageModelLatency: number;
  topCommands: Array<{ command: string; count: number }>;
  topRejectedSuggestions: Array<{ suggestion: string; count: number }>;
  recentSuggestions: SuggestionRow[];
  latencyByModel: Array<{ model: string; avgLatencyMs: number; count: number }>;
  acceptanceByPath: Array<{ path: string; accepted: number; rejected: number; acceptanceRate: number }>;
}

export interface SuggestionRow {
  id: number;
  sessionId: string;
  buffer: string;
  suggestionText: string;
  source: string;
  cwd: string;
  repoRoot: string;
  branch: string;
  modelName: string;
  latencyMs: number;
  createdAtMs: number;
  accepted: boolean;
  rejected: boolean;
  acceptedCommand: string;
  actualCommand: string;
}

export interface CommandRow {
  id: number;
  sessionId: string;
  commandText: string;
  cwd: string;
  repoRoot: string;
  branch: string;
  exitCode: number;
  durationMs: number;
  startedAtMs: number;
  finishedAtMs: number;
  stdoutExcerpt: string;
  stderrExcerpt: string;
}

export interface FeedbackRow {
  id: number;
  suggestionId: number;
  sessionId: string;
  eventType: string;
  buffer: string;
  suggestionText: string;
  acceptedCommand: string;
  actualCommand: string;
  createdAtMs: number;
}

export interface PagedResult<T> {
  total: number;
  page: number;
  pageSize: number;
  rows: T[];
}

export interface BenchmarkRunRow {
  id: number;
  status: string;
  models: string[];
  repeatCount: number;
  timeoutMs: number;
  outputJsonPath: string;
  summary: Record<string, unknown> | null;
  errorText: string;
  createdAtMs: number;
  startedAtMs: number;
  finishedAtMs: number;
}

export interface BenchmarkResultRow {
  id: number;
  runId: number;
  modelName: string;
  caseName: string;
  runNumber: number;
  latencyMs: number;
  suggestionText: string;
  validPrefix: boolean;
  accepted: boolean;
  errorText: string;
  createdAtMs: number;
}
