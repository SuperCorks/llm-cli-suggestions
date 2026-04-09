import { NextRequest, NextResponse } from "next/server";

import { startOllamaUpdate } from "@/lib/server/ollama-install";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    baseUrl?: string;
  };

  const baseUrl = payload.baseUrl?.trim();
  if (!baseUrl) {
    return NextResponse.json(
      { error: "baseUrl is required" },
      { status: 400 },
    );
  }

  const job = startOllamaUpdate(baseUrl);
  return NextResponse.json({ job });
}
