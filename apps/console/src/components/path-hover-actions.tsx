"use client";

import { FolderOpen, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

type PathHoverVariant = "block" | "inline" | "input";

interface PathHoverActionsProps {
  pathValue?: string | null;
  label: string;
  children: ReactNode;
  variant?: PathHoverVariant;
  className?: string;
}

function canOpenPath(pathValue?: string | null) {
  const normalized = pathValue?.trim() || "";
  return normalized !== "" && normalized !== "n/a" && normalized !== "(no path)";
}

export function PathHoverActions({
  pathValue,
  label,
  children,
  variant = "block",
  className = "",
}: PathHoverActionsProps) {
  const [busy, setBusy] = useState(false);
  const normalizedPath = pathValue?.trim() || "";
  const openable = canOpenPath(normalizedPath);
  const Container = variant === "inline" ? "span" : "div";
  const ActionsContainer = variant === "inline" ? "span" : "div";

  async function openPath(target: "finder" | "terminal") {
    if (!openable || busy) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/system/open-path", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          path: normalizedPath,
          target,
        }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to open path");
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Unable to open path");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container
      className={[
        "path-hover-target",
        `path-hover-target-${variant}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
      {openable ? (
        <ActionsContainer className="path-actions">
          <button
            type="button"
            className="icon-button path-action-button"
            aria-label={`Open ${label} in Finder`}
            title="Open in Finder"
            disabled={busy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void openPath("finder")}
          >
            <FolderOpen aria-hidden="true" className="path-action-icon" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            className="icon-button path-action-button"
            aria-label={`Open ${label} in Terminal`}
            title="Open in Terminal"
            disabled={busy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void openPath("terminal")}
          >
            <SquareTerminal aria-hidden="true" className="path-action-icon" strokeWidth={2.2} />
          </button>
        </ActionsContainer>
      ) : null}
    </Container>
  );
}