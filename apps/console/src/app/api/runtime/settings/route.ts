import { NextRequest, NextResponse } from "next/server";

import { saveRuntimeSettings } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as Record<string, string>;
  const settings = await saveRuntimeSettings({
    LAC_MODEL_NAME: payload.LAC_MODEL_NAME,
    LAC_MODEL_BASE_URL: payload.LAC_MODEL_BASE_URL,
    LAC_SUGGEST_STRATEGY: payload.LAC_SUGGEST_STRATEGY,
    LAC_SOCKET_PATH: payload.LAC_SOCKET_PATH,
    LAC_DB_PATH: payload.LAC_DB_PATH,
    LAC_SUGGEST_TIMEOUT_MS: payload.LAC_SUGGEST_TIMEOUT_MS,
  });
  return NextResponse.json(settings);
}
