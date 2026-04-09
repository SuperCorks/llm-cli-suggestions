import { NextRequest, NextResponse } from "next/server";

import { getOllamaUpdateStatus } from "@/lib/server/ollama-update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const baseUrl =
    request.nextUrl.searchParams.get("baseUrl")?.trim() || "http://127.0.0.1:11434";

  return NextResponse.json(getOllamaUpdateStatus(baseUrl));
}
