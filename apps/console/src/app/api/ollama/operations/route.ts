import { NextRequest, NextResponse } from "next/server";

import {
  cancelOllamaInstallJob,
  dismissOllamaInstallJob,
  listOllamaInstallJobs,
} from "@/lib/server/ollama-install";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.searchParams.get("baseUrl")?.trim() || "http://127.0.0.1:11434";
  const jobs = listOllamaInstallJobs(baseUrl);
  return NextResponse.json({ jobs });
}

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    jobId?: string;
    action?: "cancel" | "dismiss";
    baseUrl?: string;
  };

  const jobId = payload.jobId?.trim();
  const action = payload.action;
  const baseUrl = payload.baseUrl?.trim() || "http://127.0.0.1:11434";

  if (!jobId || !action) {
    return NextResponse.json(
      { error: "jobId and action are required" },
      { status: 400 },
    );
  }

  if (action === "cancel") {
    const job = cancelOllamaInstallJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "job not found" }, { status: 404 });
    }

    return NextResponse.json({ job, jobs: listOllamaInstallJobs(baseUrl) });
  }

  const dismissed = dismissOllamaInstallJob(jobId);
  if (!dismissed) {
    return NextResponse.json(
      { error: "job could not be dismissed" },
      { status: 409 },
    );
  }

  return NextResponse.json({ jobs: listOllamaInstallJobs(baseUrl) });
}