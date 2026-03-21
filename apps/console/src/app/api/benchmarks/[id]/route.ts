import { NextRequest, NextResponse } from "next/server";

import { getBenchmarkRun } from "@/lib/server/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const run = getBenchmarkRun(Number(params.id));
  if (!run) {
    return NextResponse.json({ error: "benchmark run not found" }, { status: 404 });
  }
  return NextResponse.json(run);
}
