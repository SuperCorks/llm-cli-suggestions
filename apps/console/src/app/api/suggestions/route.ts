import { NextRequest, NextResponse } from "next/server";

import { listSuggestions } from "@/lib/server/queries";
import type { SuggestionOutcome, SuggestionQualityFilter, SuggestionSort } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  return NextResponse.json(
    listSuggestions({
      page: Number(searchParams.get("page") || "1"),
      pageSize: Number(searchParams.get("pageSize") || "25"),
      source: searchParams.get("source") || undefined,
      model: searchParams.get("model") || undefined,
      session: searchParams.get("session") || undefined,
      cwd: searchParams.get("cwd") || undefined,
      repo: searchParams.get("repo") || undefined,
      query: searchParams.get("query") || undefined,
      outcome: (searchParams.get("outcome") as SuggestionOutcome | null) || "all",
      quality: (searchParams.get("quality") as SuggestionQualityFilter | null) || "all",
      sort: (searchParams.get("sort") as SuggestionSort | null) || "newest",
    }),
  );
}
