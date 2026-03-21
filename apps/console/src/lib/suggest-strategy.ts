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
    value: "model-only",
    label: "Model only",
    description:
      "Ignores history candidates and relies entirely on the model for suggestions. Best for experimentation, usually less stable.",
  },
] as const;

export type SuggestStrategy = (typeof SUGGEST_STRATEGIES)[number]["value"];

export function normalizeSuggestStrategy(value?: string): SuggestStrategy {
  if (value === "history-only" || value === "model-only") {
    return value;
  }
  return "history+model";
}

export function getSuggestStrategyDescription(value?: string) {
  const normalized = normalizeSuggestStrategy(value);
  return SUGGEST_STRATEGIES.find((option) => option.value === normalized)?.description || "";
}
