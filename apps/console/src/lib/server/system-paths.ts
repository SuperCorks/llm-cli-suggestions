import "server-only";

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type OpenPathTarget = "finder" | "terminal";

function resolveExistingPath(rawPath: string) {
  const normalized = rawPath.trim();
  if (!path.isAbsolute(normalized)) {
    throw new Error("path must be absolute");
  }
  if (!fs.existsSync(normalized)) {
    throw new Error("path does not exist");
  }
  return normalized;
}

export async function openSystemPath(rawPath: string, target: OpenPathTarget) {
  const absolutePath = resolveExistingPath(rawPath);
  const stat = fs.statSync(absolutePath);
  const openTarget = stat.isDirectory() ? absolutePath : path.dirname(absolutePath);

  const args =
    target === "finder"
      ? stat.isDirectory()
        ? [absolutePath]
        : ["-R", absolutePath]
      : ["-a", "Terminal", openTarget];

  await new Promise<void>((resolve, reject) => {
    const child = spawn("open", args, {
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`open exited with code ${code}`));
    });
  });
}
