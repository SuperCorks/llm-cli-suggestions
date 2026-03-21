import { NextResponse } from "next/server";

import { startDaemon } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await startDaemon());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start daemon" },
      { status: 500 },
    );
  }
}
