import "server-only";

import http from "node:http";

import type { RuntimeSettings } from "@/lib/types";

interface JsonValue {
  [key: string]: unknown;
}

export async function daemonRequest<T>(
  settings: RuntimeSettings,
  path: string,
  method = "GET",
  payload?: JsonValue,
): Promise<T> {
  const body = payload ? JSON.stringify(payload) : undefined;
  return new Promise<T>((resolve, reject) => {
    const request = http.request(
      {
        socketPath: settings.socketPath,
        path,
        method,
        headers: body
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            }
          : undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((response.statusCode || 500) >= 400) {
            reject(new Error(text || `daemon request failed with ${response.statusCode}`));
            return;
          }

          resolve(text ? (JSON.parse(text) as T) : ({} as T));
        });
      },
    );

    request.on("error", reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}
