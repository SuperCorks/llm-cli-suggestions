"use client";

import { SUGGEST_STRATEGIES, getSuggestStrategyDescription, type SuggestStrategy } from "@/lib/suggest-strategy";

interface SuggestStrategyFieldProps {
  label?: string;
  value: SuggestStrategy;
  onChange: (value: SuggestStrategy) => void;
}

export function SuggestStrategyField({
  label = "Suggestion Strategy",
  value,
  onChange,
}: SuggestStrategyFieldProps) {
  return (
    <div className="stack-sm">
      <label>
        {label}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as SuggestStrategy)}
        >
          {SUGGEST_STRATEGIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="helper-text">{getSuggestStrategyDescription(value)}</p>
    </div>
  );
}
