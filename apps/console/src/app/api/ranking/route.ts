import { NextRequest, NextResponse } from "next/server";

import { daemonRequest } from "@/lib/server/daemon";
import { getResolvedRuntimeSettings } from "@/lib/server/config";
import { restartDaemon, startDaemon } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecoverableDaemonError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("404 page not found") ||
    message.includes("connect: no such file or directory") ||
    message.includes("connect enoent") ||
    message.includes("socket hang up")
  );
}

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const settings = getResolvedRuntimeSettings();

  try {
    const response = await daemonRequest(settings, "/inspect", "POST", payload);
    return NextResponse.json(response);
  } catch (error) {
    if (isRecoverableDaemonError(error)) {
      try {
        if (error instanceof Error && error.message.toLowerCase().includes("404 page not found")) {
          await restartDaemon();
        } else {
          await startDaemon();
        }

        const recoveredResponse = await daemonRequest(settings, "/inspect", "POST", payload);
        return NextResponse.json(recoveredResponse);
      } catch (recoveryError) {
        return NextResponse.json(
          {
            error:
              recoveryError instanceof Error
                ? recoveryError.message
                : "ranking request failed after daemon recovery",
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ranking request failed" },
      { status: 500 },
    );
  }
}
