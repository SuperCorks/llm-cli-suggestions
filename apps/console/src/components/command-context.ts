import type { CommandRow } from "@/lib/types";

export type CommandContextSnapshot = {
  summaryTitle: string;
  summarySubtitle: string;
  outputPreviewLabel: string;
  outputPreviewText: string;
};

function shortPath(value: string) {
  if (!value) {
    return "";
  }
  const parts = value.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || value;
}

function firstLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function summarizeLine(value: string, maxLength = 72) {
  const line = firstLine(value);
  if (!line) {
    return "";
  }
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}

export function buildCommandContextSnapshot(row: CommandRow): CommandContextSnapshot {
  const location = shortPath(row.cwd || row.repoRoot) || "Session context";
  const stderrPreview = summarizeLine(row.stderrExcerpt);
  const stdoutPreview = summarizeLine(row.stdoutExcerpt);
  const repoPreview =
    row.repoRoot && row.repoRoot !== row.cwd ? `repo ${shortPath(row.repoRoot)}` : "";

  const outputPreviewLabel = stderrPreview ? "stderr" : stdoutPreview ? "stdout" : "details";
  const outputPreviewText =
    stderrPreview || stdoutPreview || [repoPreview, `exit ${row.exitCode}`].filter(Boolean).join(" · ");

  return {
    summaryTitle: location,
    summarySubtitle: [row.branch, outputPreviewLabel, outputPreviewText].filter(Boolean).join(" · "),
    outputPreviewLabel,
    outputPreviewText,
  };
}
