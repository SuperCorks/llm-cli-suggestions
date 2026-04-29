"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

function isHistorySourced(source: string) {
  return source
    .split("+")
    .map((part) => part.trim())
    .includes("history");
}

interface HistorySourceActionProps {
  source: string;
  suggestionText: string;
}

export function HistorySourceAction({ source, suggestionText }: HistorySourceActionProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [deletedCount, setDeletedCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!isHistorySourced(source)) {
    return <span>{source}</span>;
  }

  async function deleteFromHistory() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/commands", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          commandText: suggestionText,
        }),
      });
      const data = (await response.json()) as {
        deletedCount?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Unable to delete command from history");
      }
      setDeletedCount(Number(data.deletedCount || 0));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to delete command from history",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="suggestion-source-action" ref={rootRef}>
      <button
        type="button"
        className={
          open
            ? "feed-badge suggestion-source-button suggestion-source-button-open"
            : "feed-badge suggestion-source-button"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label={`History source actions for ${suggestionText}`}
        onClick={() => {
          setOpen((current) => !current);
          setError("");
        }}
      >
        {source}
      </button>

      {open ? (
        <div id={popoverId} className="suggestion-source-popover" role="dialog" aria-label="History source actions">
          <p className="suggestion-source-popover-title">History-backed suggestion</p>
          <p className="helper-text suggestion-source-popover-copy">
            Remove every exact match for this command from runtime history. Saved suggestion rows stay visible.
          </p>
          <code className="suggestion-source-command">{suggestionText}</code>
          <button
            type="button"
            className="suggestion-source-delete-button"
            disabled={pending || deletedCount !== null}
            onClick={() => void deleteFromHistory()}
          >
            <Trash2 aria-hidden="true" />
            <span>
              {pending
                ? "Deleting..."
                : deletedCount !== null
                  ? "Deleted from history"
                  : "Delete from history"}
            </span>
          </button>
          {deletedCount !== null ? (
            <p className="helper-text suggestion-source-status">
              {deletedCount > 0
                ? `Removed ${deletedCount} exact ${deletedCount === 1 ? "match" : "matches"} from command history.`
                : "No exact history matches remained for this command."}
            </p>
          ) : null}
          {error ? <p className="error-text suggestion-inline-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}