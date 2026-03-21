import { NextResponse } from "next/server";

import { getOverviewData } from "@/lib/server/queries";
import { getRuntimeStatusWithHealth } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const overview = getOverviewData();
  return NextResponse.json({
    ...overview,
    runtime: await getRuntimeStatusWithHealth(),
  });
}
