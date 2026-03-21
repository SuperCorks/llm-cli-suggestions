import { DaemonConsole } from "@/components/daemon-console";
import { Panel } from "@/components/panel";
import { listAvailableOllamaModels } from "@/lib/server/ollama";
import { getRuntimeStatusWithHealth, tailDaemonLog } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";

export default async function DaemonPage() {
  const status = await getRuntimeStatusWithHealth();
  const recentLog = tailDaemonLog(160);
  const inventory = await listAvailableOllamaModels(status.settings.modelBaseUrl);

  return (
    <div className="stack-lg">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Control</span>
          <h1>Daemon & Data Ops</h1>
          <p>Manage runtime settings, start or restart the daemon, export datasets, and safely clear selected data.</p>
        </div>
      </div>

      <Panel
        title="Runtime Control"
        subtitle="All controls are local-only and persist runtime settings to runtime.env for future fancy shells."
      >
        <DaemonConsole
          initialStatus={status}
          initialLog={recentLog}
          initialAvailableModels={inventory.models}
        />
      </Panel>
    </div>
  );
}
