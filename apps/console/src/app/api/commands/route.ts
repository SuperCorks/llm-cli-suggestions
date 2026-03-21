import { NextRequest, NextResponse } from "next/server";

import { listCommands } from "@/lib/server/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  return NextResponse.json(
    listCommands({
      page: Number(searchParams.get("page") || "1"),
      pageSize: Number(searchParams.get("pageSize") || "25"),
      session: searchParams.get("session") || undefined,
      cwd: searchParams.get("cwd") || undefined,
      repo: searchParams.get("repo") || undefined,
      query: searchParams.get("query") || undefined,
    }),
  );
}
