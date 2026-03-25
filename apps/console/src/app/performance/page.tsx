import { unstable_noStore as noStore } from "next/cache";

import { PerformanceDashboard } from "@/components/performance-dashboard";
import {
  getPerformanceDashboardData,
  getPerformanceRangeBounds,
  type PerformanceDashboardFilters,
} from "@/lib/server/performance";
import { getRuntimeStatusWithHealth } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function normalizeStartState(value?: string): PerformanceDashboardFilters["startState"] {
  if (
    value === "cold" ||
    value === "hot" ||
    value === "unknown" ||
    value === "not-applicable"
  ) {
    return value;
  }
  return "all";
}

function parseDateTimeLocal(value: string) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.getTime();
}

function toDateTimeLocalInput(timestampMs: number) {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function startOfDay(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function resolveRange(
  preset: string,
  startValue: string,
  endValue: string,
): Pick<PerformanceDashboardFilters, "preset" | "startMs" | "endMs" | "startInput" | "endInput"> {
  const now = new Date();
  const rangeBounds = getPerformanceRangeBounds();
  const currentPreset = preset || "today";
  const customStart = parseDateTimeLocal(startValue);
  const customEnd = parseDateTimeLocal(endValue);

  let startMs = 0;
  let endMs = 0;

  if (currentPreset === "custom" && customStart !== null && customEnd !== null && customEnd > customStart) {
    startMs = customStart;
    endMs = customEnd;
  } else if (currentPreset === "all-time" && rangeBounds.minCreatedAtMs !== null) {
    startMs = rangeBounds.minCreatedAtMs;
    endMs = Math.max(now.getTime(), (rangeBounds.maxCreatedAtMs || rangeBounds.minCreatedAtMs) + 1);
  } else if (currentPreset === "yesterday") {
    endMs = startOfDay(now);
    startMs = endMs - 24 * 60 * 60 * 1000;
  } else if (currentPreset === "last-24h") {
    endMs = now.getTime();
    startMs = endMs - 24 * 60 * 60 * 1000;
  } else if (currentPreset === "last-7d") {
    endMs = now.getTime();
    startMs = endMs - 7 * 24 * 60 * 60 * 1000;
  } else if (currentPreset === "last-30d") {
    endMs = now.getTime();
    startMs = endMs - 30 * 24 * 60 * 60 * 1000;
  } else {
    startMs = startOfDay(now);
    endMs = now.getTime();
  }

  if (endMs <= startMs) {
    endMs = startMs + 60 * 60 * 1000;
  }

  return {
    preset: currentPreset,
    startMs,
    endMs,
    startInput: toDateTimeLocalInput(startMs),
    endInput: toDateTimeLocalInput(endMs),
  };
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();
  const params = await searchParams;
  const runtime = await getRuntimeStatusWithHealth();
  const activeModel = runtime.health.ok ? runtime.health.modelName : runtime.settings.modelName;
  const range = resolveRange(
    getString(params.preset) || "today",
    getString(params.start),
    getString(params.end),
  );

  const filters: PerformanceDashboardFilters = {
    ...range,
    model: getString(params.model) || activeModel || "",
    source: getString(params.source),
    startState: normalizeStartState(getString(params.startState)),
  };
  const data = getPerformanceDashboardData(filters);

  return <PerformanceDashboard data={data} activeModel={activeModel} />;
}
