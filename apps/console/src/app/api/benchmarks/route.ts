import { NextResponse } from "next/server";

import { listBenchmarkRuns } from "@/lib/server/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ runs: listBenchmarkRuns() });
}
