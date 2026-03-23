import { NextRequest, NextResponse } from "next/server";

import { startOllamaRemove } from "@/lib/server/ollama-install";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    model?: string;
    baseUrl?: string;
  };

  const model = payload.model?.trim();
  const baseUrl = payload.baseUrl?.trim();

  if (!model || !baseUrl) {
    return NextResponse.json(
      { error: "model and baseUrl are required" },
      { status: 400 },
    );
  }

  const job = startOllamaRemove(model, baseUrl);
  return NextResponse.json({ job });
}
