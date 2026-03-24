import { NextRequest, NextResponse } from "next/server";

import {
  normalizeAcceptSuggestionKey,
  normalizePtyCaptureCommandList,
  normalizePtyCaptureMode,
} from "@/lib/server/config";
import { saveRuntimeSettings } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as Record<string, string>;
  const normalizedAcceptKey = normalizeAcceptSuggestionKey(payload.LAC_ACCEPT_KEY);
  const normalizedMode = normalizePtyCaptureMode(payload.LAC_PTY_CAPTURE_MODE);
  const normalizedAllowlist = normalizePtyCaptureCommandList(payload.LAC_PTY_CAPTURE_ALLOWLIST);
  const normalizedBlocklist = normalizePtyCaptureCommandList(payload.LAC_PTY_CAPTURE_BLOCKLIST);
  const settings = await saveRuntimeSettings({
    LAC_MODEL_NAME: payload.LAC_MODEL_NAME,
    LAC_MODEL_BASE_URL: payload.LAC_MODEL_BASE_URL,
    LAC_MODEL_KEEP_ALIVE: payload.LAC_MODEL_KEEP_ALIVE,
    LAC_SUGGEST_STRATEGY: payload.LAC_SUGGEST_STRATEGY,
    LAC_SYSTEM_PROMPT_STATIC: payload.LAC_SYSTEM_PROMPT_STATIC,
    LAC_SOCKET_PATH: payload.LAC_SOCKET_PATH,
    LAC_DB_PATH: payload.LAC_DB_PATH,
    LAC_SUGGEST_TIMEOUT_MS: payload.LAC_SUGGEST_TIMEOUT_MS,
    LAC_ACCEPT_KEY: normalizedAcceptKey,
    LAC_PTY_CAPTURE_MODE: normalizedMode,
    LAC_PTY_CAPTURE_ALLOWLIST: normalizedAllowlist,
    LAC_PTY_CAPTURE_BLOCKLIST: normalizedBlocklist,
  });
  return NextResponse.json(settings);
}
