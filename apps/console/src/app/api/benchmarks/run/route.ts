import { NextRequest, NextResponse } from "next/server";

import { createBenchmarkRun } from "@/lib/server/benchmarks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    track?: "static" | "replay" | "raw";
    suiteName?: string;
    strategy?: "history-only" | "history+model" | "model-only";
    timingProtocol?: "cold_only" | "hot_only" | "mixed" | "full";
    models?: string[];
    repeatCount?: number;
    timeoutMs?: number;
    replaySampleLimit?: number;
  };
  const models = (payload.models || []).map((value) => value.trim()).filter(Boolean);
  if (models.length === 0) {
    return NextResponse.json({ error: "at least one model is required" }, { status: 400 });
  }

  const run = createBenchmarkRun({
    track: payload.track || "static",
    suiteName: (payload.suiteName || "").trim() || (payload.track === "replay" ? "live-db" : "core"),
    strategy: payload.strategy || "history+model",
    timingProtocol: payload.timingProtocol || "full",
    models,
    repeatCount: Math.max(1, payload.repeatCount || 1),
    timeoutMs: Math.max(500, payload.timeoutMs || 5000),
    replaySampleLimit: Math.max(1, payload.replaySampleLimit || 200),
  });
  return NextResponse.json(run, { status: 202 });
}
