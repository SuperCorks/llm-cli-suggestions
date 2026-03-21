import { NextResponse } from "next/server";

import { getRuntimeStatusWithHealth, tailDaemonLog } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getRuntimeStatusWithHealth();
  return NextResponse.json({
    ...status,
    recentLog: tailDaemonLog(120),
  });
}
