import "server-only";

interface JsonEventStreamOptions<T> {
  requestSignal: AbortSignal;
  getSnapshot: () => T;
  intervalMs?: number;
}

export function createJsonEventStream<T>({
  requestSignal,
  getSnapshot,
  intervalMs = 1200,
}: JsonEventStreamOptions<T>) {
  const encoder = new TextEncoder();
  let snapshotTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let lastPayload = "";

  const cleanup = () => {
    if (snapshotTimer) {
      clearInterval(snapshotTimer);
      snapshotTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        cleanup();
        requestSignal.removeEventListener("abort", close);
        controller.close();
      };

      const pushSnapshot = (force = false) => {
        const payload = JSON.stringify(getSnapshot());
        if (!force && payload === lastPayload) {
          return;
        }
        lastPayload = payload;
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      requestSignal.addEventListener("abort", close, { once: true });

      try {
        controller.enqueue(encoder.encode("retry: 1500\n\n"));
        pushSnapshot(true);
      } catch (error) {
        cleanup();
        requestSignal.removeEventListener("abort", close);
        controller.error(error);
        return;
      }

      snapshotTimer = setInterval(() => {
        if (closed) {
          return;
        }
        try {
          pushSnapshot();
        } catch (error) {
          closed = true;
          cleanup();
          requestSignal.removeEventListener("abort", close);
          controller.error(error);
        }
      }, intervalMs);

      heartbeatTimer = setInterval(() => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15000);
    },
    cancel() {
      closed = true;
      cleanup();
    },
  });
}

export const EVENT_STREAM_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "Content-Type": "text/event-stream",
  "X-Accel-Buffering": "no",
};