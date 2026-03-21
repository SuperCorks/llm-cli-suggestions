import { NextResponse } from "next/server";

import { getOllamaInstallJob } from "@/lib/server/ollama-install";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const job = getOllamaInstallJob(id);
  if (!job) {
    return NextResponse.json({ error: "install job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}
