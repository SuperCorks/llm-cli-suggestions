import { NextResponse } from "next/server";

import { restartDaemon } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await restartDaemon());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to restart daemon" },
      { status: 500 },
    );
  }
}
