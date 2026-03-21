import { NextRequest, NextResponse } from "next/server";

import { openSystemPath, type OpenPathTarget } from "@/lib/server/system-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      path?: string;
      target?: OpenPathTarget;
    };

    if (!payload.path || !payload.target) {
      return NextResponse.json(
        { error: "path and target are required" },
        { status: 400 },
      );
    }

    if (payload.target !== "finder" && payload.target !== "terminal") {
      return NextResponse.json({ error: "invalid open target" }, { status: 400 });
    }

    await openSystemPath(payload.path, payload.target);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unable to open path" },
      { status: 500 },
    );
  }
}
