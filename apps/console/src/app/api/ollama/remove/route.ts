import { NextRequest, NextResponse } from "next/server";

import { removeOllamaModel } from "@/lib/server/ollama";

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

  try {
    await removeOllamaModel(baseUrl, model);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to remove model from Ollama",
      },
      { status: 500 },
    );
  }
}
