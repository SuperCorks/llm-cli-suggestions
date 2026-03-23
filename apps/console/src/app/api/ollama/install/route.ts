import { NextRequest, NextResponse } from "next/server";

import { startOllamaInstall } from "@/lib/server/ollama-install";
import { isRemoteLibraryModelName } from "@/lib/server/ollama";

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

  if (isRemoteLibraryModelName(model)) {
    return NextResponse.json(
      { error: "Cloud and remote-only Ollama models cannot be downloaded locally." },
      { status: 400 },
    );
  }

  const job = startOllamaInstall(model, baseUrl);
  return NextResponse.json({ job });
}
