import { NextRequest, NextResponse } from "next/server";

import { setSuggestionReview } from "@/lib/server/queries";
import type { SuggestionQuality } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      suggestionId?: number;
      label?: SuggestionQuality | null;
    };

    const result = setSuggestionReview(
      Number(payload.suggestionId || 0),
      payload.label === "good" || payload.label === "bad" ? payload.label : null,
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unable to save suggestion review" },
      { status: 400 },
    );
  }
}
