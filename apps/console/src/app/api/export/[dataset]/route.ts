import { NextRequest, NextResponse } from "next/server";

import { toCsv, toJsonl } from "@/lib/server/export";
import { exportRows } from "@/lib/server/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ dataset: string }> },
) {
  const params = await context.params;
  const dataset = params.dataset;
  if (!["suggestions", "commands", "benchmarks"].includes(dataset)) {
    return NextResponse.json({ error: "unknown dataset" }, { status: 404 });
  }

  const format = request.nextUrl.searchParams.get("format") || "jsonl";
  const rows = exportRows(dataset as "suggestions" | "commands" | "benchmarks");
  const body = format === "csv" ? toCsv(rows) : toJsonl(rows);
  const extension = format === "csv" ? "csv" : "jsonl";
  return new NextResponse(body, {
    headers: {
      "Content-Type":
        format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="${dataset}.${extension}"`,
    },
  });
}
