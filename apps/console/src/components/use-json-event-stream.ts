"use client";

import { useEffect, useEffectEvent, useState } from "react";

export type LiveStreamStatus = "connecting" | "live" | "reconnecting";

export function useJsonEventStream<T>(url: string, onData: (payload: T) => void) {
  const [streamState, setStreamState] = useState<{ url: string; status: LiveStreamStatus }>({
    url,
    status: "connecting",
  });
  const onDataEvent = useEffectEvent(onData);

  useEffect(() => {
    const stream = new EventSource(url);

    stream.onopen = () => {
      setStreamState({ url, status: "live" });
    };
    stream.onmessage = (event) => {
      try {
        onDataEvent(JSON.parse(event.data) as T);
        setStreamState({ url, status: "live" });
      } catch {
        // Ignore malformed events and wait for the next payload.
      }
    };
    stream.onerror = () => {
      setStreamState((current) => ({
        url,
        status:
          current.url === url && current.status === "live" ? "reconnecting" : "connecting",
      }));
    };

    return () => {
      stream.close();
    };
  }, [url]);

  return streamState.url === url ? streamState.status : "connecting";
}