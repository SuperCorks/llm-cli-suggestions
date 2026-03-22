"use client";

import { useState } from "react";

import { useJsonEventStream, type LiveStreamStatus } from "@/components/use-json-event-stream";
import type { ActivitySignal } from "@/lib/types";

interface LiveActivityStreamProps {
  initialSignals: ActivitySignal[];
}

function formatStreamStatus(status: LiveStreamStatus) {
  if (status === "live") {
    return "Live";
  }
  if (status === "reconnecting") {
    return "Reconnecting";
  }
  return "Connecting";
}

export function LiveActivityStream({ initialSignals }: LiveActivityStreamProps) {
  const [signals, setSignals] = useState(initialSignals);
  const streamStatus = useJsonEventStream<{ signals?: ActivitySignal[] }>(
    "/api/overview/activity/stream?limit=6",
    (payload) => {
      setSignals(payload.signals || []);
    },
  );

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span className="terminal-lights">
          <i />
          <i />
          <i />
        </span>
        <div className="terminal-stream-meta">
          <span className="terminal-meta">session.log - local activity stream</span>
          <span className={`stream-indicator stream-indicator-${streamStatus}`}>
            {formatStreamStatus(streamStatus)}
          </span>
        </div>
      </div>
      <div className="terminal-body" aria-live="polite">
        {signals.map((signal) => (
          <p key={signal.id} className="terminal-line">
            <span className="terminal-time">{signal.timestamp}</span>{" "}
            <span className={`terminal-tag terminal-tag-${signal.tone}`}>{signal.label}</span>{" "}
            <span>{signal.message}</span>
          </p>
        ))}
        {signals.length === 0 ? (
          <p className="terminal-line">
            <span className="terminal-time">standby</span>{" "}
            <span className="terminal-tag terminal-tag-observed">TRACE</span> Waiting for local activity...
          </p>
        ) : null}
      </div>
    </div>
  );
}