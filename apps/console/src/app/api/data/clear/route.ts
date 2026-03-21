import { NextRequest, NextResponse } from "next/server";

import { clearDataset } from "@/lib/server/queries";

const CONFIRMATIONS = {
  suggestions: "DELETE_SUGGESTIONS",
  feedback: "DELETE_FEEDBACK",
  benchmarks: "DELETE_BENCHMARKS",
} as const;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    dataset?: keyof typeof CONFIRMATIONS;
    confirmation?: string;
  };
  const dataset = payload.dataset;
  if (!dataset || !(dataset in CONFIRMATIONS)) {
    return NextResponse.json({ error: "unknown dataset" }, { status: 400 });
  }
  if (payload.confirmation !== CONFIRMATIONS[dataset]) {
    return NextResponse.json(
      { error: `confirmation must match ${CONFIRMATIONS[dataset]}` },
      { status: 400 },
    );
  }

  clearDataset(dataset);
  return NextResponse.json({ status: "ok" });
}
