import { NextRequest, NextResponse } from "next/server";

import { createBenchmarkRun } from "@/lib/server/benchmarks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    models?: string[];
    repeatCount?: number;
    timeoutMs?: number;
  };
  const models = (payload.models || []).map((value) => value.trim()).filter(Boolean);
  if (models.length === 0) {
    return NextResponse.json({ error: "at least one model is required" }, { status: 400 });
  }

  const run = createBenchmarkRun({
    models,
    repeatCount: Math.max(1, payload.repeatCount || 1),
    timeoutMs: Math.max(500, payload.timeoutMs || 5000),
  });
  return NextResponse.json(run, { status: 202 });
}
