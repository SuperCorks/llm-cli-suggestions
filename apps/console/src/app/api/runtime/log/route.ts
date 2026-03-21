import { NextRequest, NextResponse } from "next/server";

import { tailDaemonLog } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const lines = Number(request.nextUrl.searchParams.get("lines") || "120");
  return NextResponse.json({ log: tailDaemonLog(lines) });
}
