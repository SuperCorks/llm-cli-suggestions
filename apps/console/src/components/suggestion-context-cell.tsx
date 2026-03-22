"use client";

interface SuggestionContextCellProps {
  title: string;
  subtitle: string;
  selected: boolean;
  onSelect: () => void;
}

export function SuggestionContextCell({
  title,
  subtitle,
  selected,
  onSelect,
}: SuggestionContextCellProps) {
  return (
    <button
      type="button"
      className={selected ? "context-summary-button context-summary-button-active" : "context-summary-button"}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="context-summary-title">{title}</span>
      <span className="context-summary-subtitle">{subtitle || "View stored prompt and structured context"}</span>
    </button>
  );
}
