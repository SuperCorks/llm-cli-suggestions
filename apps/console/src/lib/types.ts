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
export type PtyCaptureMode = "allowlist" | "blocklist";
export type AcceptSuggestionKey = "tab" | "right-arrow";

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
  acceptKey: AcceptSuggestionKey;
  ptyCaptureMode: PtyCaptureMode;
  ptyCaptureAllowlist: string;
  ptyCaptureBlocklist: string;
}

export interface OllamaModelOption {
  name: string;
  installed: boolean;
  source: "installed" | "library";
  sizeLabel?: string;
  contextWindowLabel?: string;
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

export type BenchmarkTrack = "static" | "replay" | "raw";
export type BenchmarkSurface = "end_to_end" | "raw_model";
export type BenchmarkTimingProtocol = "cold_only" | "hot_only" | "mixed" | "full";
export type BenchmarkTimingPhase = "cold" | "hot" | "mixed";
export type BenchmarkStartState = "cold" | "hot" | "unknown" | "not_applicable";
export type BenchmarkLabelKind = "positive" | "negative";

export interface BenchmarkEnvironment {
  hostname: string;
  os: string;
  arch: string;
  goVersion: string;
  modelBaseURL: string;
  modelKeepAlive: string;
  activeModelName: string;
  dbPath: string;
}

export interface BenchmarkProgress {
  completed: number;
  total: number;
  percent: number;
  status: string;
  currentModel: string;
  currentCase: string;
  currentRun: number;
  currentPhase: string;
}

export interface BenchmarkLatencyStats {
  count: number;
  mean: number;
  median: number;
  p90: number;
  p95: number;
  max: number;
}

export interface BenchmarkQualitySummary {
  positiveCaseCount: number;
  negativeCaseCount: number;
  positiveExactHitRate: number;
  negativeAvoidRate: number;
  validWinnerRate: number;
  candidateRecallAt3: number;
  charsSavedRatio: number;
}

export interface BenchmarkStartStateSummary {
  key: BenchmarkStartState;
  count: number;
  share: number;
  latency: BenchmarkLatencyStats;
}

export interface BenchmarkStageSummary {
  label: string;
  count: number;
  avgRequestLatencyMs: number;
  avgModelTotalDurationMs: number;
  avgLoadDurationMs: number;
  avgPromptEvalDurationMs: number;
  avgEvalDurationMs: number;
  avgNonModelOverheadMs: number;
  decodeTokensPerSecond: number;
}

export interface BenchmarkBudgetPassRate {
  budgetMs: number;
  rate: number;
}

export interface BenchmarkBucketSummary {
  key: string;
  label: string;
  count: number;
  share: number;
  quality: BenchmarkQualitySummary;
  latency: BenchmarkLatencyStats;
}

export interface BenchmarkAggregateSummary {
  count: number;
  quality: BenchmarkQualitySummary;
  latency: BenchmarkLatencyStats;
  startStates: BenchmarkStartStateSummary[];
  coldPenaltyMs: number;
  stages: BenchmarkStageSummary[];
  budgetPassRates: BenchmarkBudgetPassRate[];
  categoryBreakdown: BenchmarkBucketSummary[];
  sourceBreakdown: BenchmarkBucketSummary[];
}

export interface BenchmarkModelSummary {
  model: string;
  overall: BenchmarkAggregateSummary;
  cold: BenchmarkAggregateSummary;
  hot: BenchmarkAggregateSummary;
}

export interface BenchmarkRunSummary {
  progress: BenchmarkProgress;
  track: BenchmarkTrack;
  surface: BenchmarkSurface;
  suiteName: string;
  strategy: string;
  timingProtocol: BenchmarkTimingProtocol;
  datasetSize: number;
  positiveCaseCount: number;
  negativeCaseCount: number;
  overall: BenchmarkAggregateSummary;
  models: BenchmarkModelSummary[];
}

export interface BenchmarkRunRow {
  id: number;
  status: string;
  track: BenchmarkTrack;
  surface: BenchmarkSurface;
  suiteName: string;
  strategy: string;
  timingProtocol: BenchmarkTimingProtocol;
  models: string[];
  repeatCount: number;
  timeoutMs: number;
  filtersJson: string;
  datasetSize: number;
  environment: BenchmarkEnvironment | null;
  outputJsonPath: string;
  summary: BenchmarkRunSummary | null;
  logText: string;
  lastEventAtMs: number;
  errorText: string;
  createdAtMs: number;
  startedAtMs: number;
  finishedAtMs: number;
}

export interface BenchmarkResultRow {
  id: number;
  runId: number;
  modelName: string;
  track: BenchmarkTrack;
  surface: BenchmarkSurface;
  suiteName: string;
  strategy: string;
  timingProtocol: BenchmarkTimingProtocol;
  timingPhase: BenchmarkTimingPhase;
  startState: BenchmarkStartState;
  caseId: string;
  caseName: string;
  category: string;
  tags: string[];
  labelKind: BenchmarkLabelKind;
  runNumber: number;
  requestJson: string;
  expectedCommand: string;
  expectedAlternatives: string[];
  negativeTarget: string;
  winnerCommand: string;
  winnerSource: string;
  candidatesJson: string;
  rawModelOutput: string;
  cleanedModelOutput: string;
  exactMatch: boolean;
  alternativeMatch: boolean;
  negativeAvoided: boolean;
  validPrefix: boolean;
  candidateHitAt3: boolean;
  charsSavedRatio: number;
  commandEditDistance: number;
  requestLatencyMs: number;
  modelTotalDurationMs: number;
  modelLoadDurationMs: number;
  modelPromptEvalDurationMs: number;
  modelEvalDurationMs: number;
  modelPromptEvalCount: number;
  modelEvalCount: number;
  decodeTokensPerSecond: number;
  nonModelOverheadDurationMs: number;
  modelError: string;
  errorText: string;
  replaySourceJson: string;
  createdAtMs: number;
}
