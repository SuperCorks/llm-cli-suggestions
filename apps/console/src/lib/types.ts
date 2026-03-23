export type SuggestionOutcome = "all" | "accepted" | "rejected" | "unreviewed";
export type SuggestionQuality = "good" | "bad";
export type SuggestionQualityFilter = "all" | SuggestionQuality | "unlabeled";
export type SuggestionSort =
  | "newest"
  | "oldest"
  | "latency-desc"
  | "latency-asc"
  | "buffer-asc"
  | "model-asc"
  | "quality-desc";
export type ClearDataset = "suggestions" | "feedback" | "benchmarks";
export type SuggestStrategy = "history-only" | "history+model" | "model-only";

export interface RuntimeSettings {
  stateDir: string;
  runtimeEnvPath: string;
  socketPath: string;
  dbPath: string;
  modelName: string;
  modelBaseUrl: string;
  modelKeepAlive: string;
  suggestStrategy: SuggestStrategy;
  systemPromptStatic: string;
  suggestTimeoutMs: number;
  ptyCaptureAllowlist: string;
}

export interface OllamaModelOption {
  name: string;
  installed: boolean;
  source: "installed" | "library";
  capabilities?: string[];
  remoteOnly?: boolean;
}

export interface OllamaInstallJob {
  id: string;
  model: string;
  action: "install" | "remove";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  message: string;
  progressPercent: number;
  completed: number;
  total: number;
  error: string;
  startedAtMs: number;
  updatedAtMs: number;
  finishedAtMs: number;
}

export interface RuntimeMemoryStatus {
  daemonRssBytes: number | null;
  modelLoadedBytes: number | null;
  modelVramBytes: number | null;
  totalTrackedBytes: number | null;
  modelName: string | null;
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
  memory: RuntimeMemoryStatus;
}

export interface ActivitySignal {
  id: number;
  timestamp: string;
  tone: "accepted" | "rejected" | "observed";
  label: "ACCEPT" | "REJECT" | "TRACE";
  message: string;
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
  lastExitCode: number;
  modelName: string;
  latencyMs: number;
  createdAtMs: number;
  accepted: boolean;
  rejected: boolean;
  acceptedCommand: string;
  actualCommand: string;
  promptText: string;
  structuredContextJson: string;
  qualityLabel: SuggestionQuality | null;
  qualityUpdatedAtMs: number;
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
