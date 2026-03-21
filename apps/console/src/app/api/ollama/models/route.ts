import { NextRequest, NextResponse } from "next/server";

import { listAvailableOllamaModels } from "@/lib/server/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.searchParams.get("baseUrl")?.trim() || "http://127.0.0.1:11434";
  const inventory = await listAvailableOllamaModels(baseUrl);
  return NextResponse.json(inventory);
}
