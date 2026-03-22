"use client";

import { useState } from "react";

import type { SuggestionQuality } from "@/lib/types";

interface SuggestionQualityControlProps {
  suggestionId: number;
  initialLabel: SuggestionQuality | null;
}

export function SuggestionQualityControl({
  suggestionId,
  initialLabel,
}: SuggestionQualityControlProps) {
  const [label, setLabel] = useState<SuggestionQuality | null>(initialLabel);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function updateLabel(nextLabel: SuggestionQuality | null) {
    setPending(true);
    setError("");
    const previous = label;
    setLabel(nextLabel);
    try {
      const response = await fetch("/api/suggestions/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          suggestionId,
          label: nextLabel,
        }),
      });
      const data = (await response.json()) as {
        qualityLabel?: SuggestionQuality | null;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Unable to update suggestion label");
      }
      setLabel(data.qualityLabel ?? null);
    } catch (requestError) {
      setLabel(previous);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update suggestion label",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="suggestion-quality-control">
      <div className="quality-toggle-group" role="group" aria-label="Suggestion quality">
        <button
          type="button"
          className={label === "good" ? "quality-toggle-button active good" : "quality-toggle-button"}
          disabled={pending}
          onClick={() => void updateLabel(label === "good" ? null : "good")}
        >
          Good
        </button>
        <button
          type="button"
          className={label === "bad" ? "quality-toggle-button active bad" : "quality-toggle-button"}
          disabled={pending}
          onClick={() => void updateLabel(label === "bad" ? null : "bad")}
        >
          Bad
        </button>
        {label ? (
          <button
            type="button"
            className="quality-toggle-button clear"
            disabled={pending}
            onClick={() => void updateLabel(null)}
          >
            Clear
          </button>
        ) : null}
      </div>
      {error ? <p className="error-text suggestion-inline-error">{error}</p> : null}
    </div>
  );
}
