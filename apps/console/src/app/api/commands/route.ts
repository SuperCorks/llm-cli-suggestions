import { NextRequest, NextResponse } from "next/server";

import { deleteCommandsByExactText, listCommands } from "@/lib/server/queries";

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

export async function DELETE(request: NextRequest) {
  let payload: { commandText?: string };

  try {
    payload = (await request.json()) as { commandText?: string };
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const commandText = String(payload.commandText || "");
  if (!commandText.trim()) {
    return NextResponse.json({ error: "commandText is required" }, { status: 400 });
  }

  const deletedCount = deleteCommandsByExactText(commandText);
  return NextResponse.json({ status: "ok", deletedCount });
}
