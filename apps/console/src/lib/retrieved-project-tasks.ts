import type { RetrievedProjectTask } from "@/lib/types";

function recordValue(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeRetrievedProjectTask(value: unknown): RetrievedProjectTask | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return {
      source: "unknown",
      name: trimmed,
      command: trimmed,
    };
  }

  const row = recordValue(value);
  const source = String(row.source || "unknown").trim() || "unknown";
  const name = String(row.name || row.task || row.label || row.command || "").trim();
  const command = String(row.command || row.display || row.runnable || name).trim();
  if (!name && !command) {
    return null;
  }
  return {
    source,
    name: name || command,
    command: command || name,
  };
}

export function normalizeRetrievedProjectTasks(value: unknown): RetrievedProjectTask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeRetrievedProjectTask(entry))
    .filter((entry): entry is RetrievedProjectTask => Boolean(entry));
}

function groupLabel(source: string) {
  switch (source) {
    case "package.json script":
      return "package.json scripts";
    case "Makefile target":
      return "Makefile targets";
    case "justfile recipe":
      return "justfile recipes";
    case "unknown":
      return "other project commands";
    default:
      return source;
  }
}

export function formatRetrievedProjectTasks(tasks: RetrievedProjectTask[]) {
  if (tasks.length === 0) {
    return "";
  }

  const groups = new Map<string, RetrievedProjectTask[]>();
  for (const task of tasks) {
    const source = task.source || "unknown";
    const existing = groups.get(source);
    if (existing) {
      existing.push(task);
      continue;
    }
    groups.set(source, [task]);
  }

  return [...groups.entries()]
    .map(([source, values]) => {
      const lines = values.map((task) => `- ${task.command}`);
      return `${groupLabel(source)}:\n${lines.join("\n")}`;
    })
    .join("\n\n");
}