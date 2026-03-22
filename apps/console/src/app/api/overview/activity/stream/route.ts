import { NextRequest } from "next/server";

import { createJsonEventStream, EVENT_STREAM_HEADERS } from "@/lib/server/event-stream";
import { getRecentActivitySignals } from "@/lib/server/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, parsed));
}

export async function GET(request: NextRequest) {
  const limit = readPositiveInt(request.nextUrl.searchParams.get("limit"), 6, 20);
  const intervalMs = readPositiveInt(request.nextUrl.searchParams.get("intervalMs"), 1200, 5000);

  return new Response(
    createJsonEventStream({
      requestSignal: request.signal,
      intervalMs,
      getSnapshot: () => ({ signals: getRecentActivitySignals(limit) }),
    }),
    { headers: EVENT_STREAM_HEADERS },
  );
}