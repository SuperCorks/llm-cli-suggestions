export const SUGGEST_STRATEGIES = [
  {
    value: "history-only",
    label: "History only",
    description:
      "Uses past command history only. Fastest and closest to classic terminal autosuggestions.",
  },
  {
    value: "history+model",
    label: "History + model",
    description:
      "Uses history first, then calls the model when history is not confident enough. This is the current hybrid mode.",
  },
  {
    value: "history-then-model",
    label: "History then large model",
    description:
      "Shows a history result first when available, then lets the primary model rerank and replace it with a stronger suggestion.",
  },
  {
    value: "history-then-fast-then-model",
    label: "History then fast then large model",
    description:
      "Shows history first, then a fast-model refinement, then a final rerank from the primary model.",
  },
  {
    value: "fast-then-model",
    label: "Fast then large models",
    description:
      "Skips history, shows a fast-model result first, then replaces it with a final refinement from the primary model.",
  },
  {
    value: "model-only",
    label: "Single Model Only",
    description:
      "Ignores history candidates and relies entirely on the model for suggestions. Best for experimentation, usually less stable.",
  },
] as const;

export type SuggestStrategy = (typeof SUGGEST_STRATEGIES)[number]["value"];

export function normalizeSuggestStrategy(value?: string): SuggestStrategy {
  if (
    value === "history-only" ||
    value === "history-then-model" ||
    value === "history-then-fast-then-model" ||
    value === "fast-then-model" ||
    value === "model-only"
  ) {
    return value;
  }
  return "history+model";
}

export function getSuggestStrategyDescription(value?: string) {
  const normalized = normalizeSuggestStrategy(value);
  return SUGGEST_STRATEGIES.find((option) => option.value === normalized)?.description || "";
}
