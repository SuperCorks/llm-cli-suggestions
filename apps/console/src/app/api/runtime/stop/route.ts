import { NextResponse } from "next/server";

import { stopDaemon } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await stopDaemon());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to stop daemon" },
      { status: 500 },
    );
  }
}
