import { NextRequest, NextResponse } from "next/server";

import { deleteBenchmarkRun, getBenchmarkRun } from "@/lib/server/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const runId = Number(params.id);
  if (!Number.isFinite(runId) || runId <= 0) {
    return NextResponse.json({ error: "invalid benchmark run id" }, { status: 400 });
  }

  const run = getBenchmarkRun(runId);
  if (!run) {
    return NextResponse.json({ error: "benchmark run not found" }, { status: 404 });
  }
  return NextResponse.json(run);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const runId = Number(params.id);
  if (!Number.isFinite(runId) || runId <= 0) {
    return NextResponse.json({ error: "invalid benchmark run id" }, { status: 400 });
  }

  try {
    const result = deleteBenchmarkRun(runId);
    if (!result.ok) {
      if (result.reason === "not_found") {
        return NextResponse.json({ error: "benchmark run not found" }, { status: 404 });
      }

      return NextResponse.json(
        {
          error: `Cannot delete benchmark run #${runId} while it is ${result.status}.`,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ deletedRunId: result.deletedRunId });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "unable to delete benchmark run",
      },
      { status: 500 },
    );
  }
}
