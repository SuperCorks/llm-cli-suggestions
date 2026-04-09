"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { OllamaInstallJob, OllamaUpdateStatus } from "@/lib/types";

interface ModelsPageActionsProps {
  modelBaseUrl: string;
}

const DEFAULT_UPDATE_STATUS: OllamaUpdateStatus = {
  supported: false,
  outdated: false,
  installKind: null,
  installedVersion: "",
  latestVersion: "",
};

function isActiveOperation(status: OllamaInstallJob["status"]) {
  return status === "pending" || status === "running";
}

export function ModelsPageActions({ modelBaseUrl }: ModelsPageActionsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<OllamaUpdateStatus>(DEFAULT_UPDATE_STATUS);
  const [loading, setLoading] = useState(true);
  const [startingUpdate, setStartingUpdate] = useState(false);
  const [activeUpdateJobId, setActiveUpdateJobId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refreshStatus = useCallback(async () => {
    const response = await fetch(
      `/api/ollama/update/status?baseUrl=${encodeURIComponent(modelBaseUrl)}`,
      { cache: "no-store" },
    );
    const data = (await response.json()) as OllamaUpdateStatus & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Unable to check the local Ollama version");
    }
    if (mountedRef.current) {
      setStatus(data);
    }
    return data;
  }, [modelBaseUrl]);

  const refreshOperations = useCallback(async () => {
    const response = await fetch(
      `/api/ollama/operations?baseUrl=${encodeURIComponent(modelBaseUrl)}`,
      { cache: "no-store" },
    );
    const data = (await response.json()) as {
      jobs?: OllamaInstallJob[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error || "Unable to refresh model operations");
    }
    return data.jobs || [];
  }, [modelBaseUrl]);

  useEffect(() => {
    mountedRef.current = true;

    async function hydrate() {
      try {
        const [nextStatus, jobs] = await Promise.all([refreshStatus(), refreshOperations()]);
        if (!mountedRef.current) {
          return;
        }
        const activeUpdate = jobs.find(
          (job) => job.action === "update" && isActiveOperation(job.status),
        );
        setStatus(nextStatus);
        setActiveUpdateJobId(activeUpdate?.id || null);
      } catch {
        if (mountedRef.current) {
          setStatus(DEFAULT_UPDATE_STATUS);
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    }

    void hydrate();

    return () => {
      mountedRef.current = false;
    };
  }, [refreshOperations, refreshStatus]);

  useEffect(() => {
    if (!activeUpdateJobId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshOperations()
        .then(async (jobs) => {
          const activeUpdate = jobs.find(
            (job) => job.id === activeUpdateJobId && isActiveOperation(job.status),
          );
          if (activeUpdate) {
            return;
          }

          const nextStatus = await refreshStatus();
          if (!mountedRef.current) {
            return;
          }
          setActiveUpdateJobId(null);
          setStartingUpdate(false);
          if (!nextStatus.outdated) {
            router.refresh();
          }
        })
        .catch(() => {
          if (mountedRef.current) {
            setActiveUpdateJobId(null);
            setStartingUpdate(false);
          }
        });
    }, 700);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeUpdateJobId, refreshOperations, refreshStatus, router]);

  const label = useMemo(() => {
    if (status.installedVersion && status.latestVersion) {
      return `Ollama ${status.installedVersion} installed; ${status.latestVersion} available`;
    }
    return "A newer Homebrew-managed Ollama is available.";
  }, [status.installedVersion, status.latestVersion]);

  async function handleUpdate() {
    setStartingUpdate(true);
    try {
      const response = await fetch("/api/ollama/update", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          baseUrl: modelBaseUrl,
        }),
      });
      const data = (await response.json()) as {
        job?: OllamaInstallJob;
        error?: string;
      };
      if (!response.ok || !data.job) {
        throw new Error(data.error || "Unable to start the Ollama update");
      }

      setActiveUpdateJobId(data.job.id);
    } catch {
      if (mountedRef.current) {
        setStartingUpdate(false);
      }
    }
  }

  if (loading || !status.supported) {
    return null;
  }

  if (activeUpdateJobId) {
    return (
      <div className="page-heading-actions">
        <button type="button" className="button-secondary" disabled>
          Updating Ollama...
        </button>
      </div>
    );
  }

  if (!status.outdated) {
    return null;
  }

  return (
    <div className="page-heading-actions">
      <div className="page-heading-note">{label}</div>
      <button type="button" onClick={() => void handleUpdate()} disabled={startingUpdate}>
        {startingUpdate ? "Starting Update..." : "Update Ollama"}
      </button>
    </div>
  );
}
