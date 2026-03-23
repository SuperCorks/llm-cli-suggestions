import { unstable_noStore as noStore } from "next/cache";

import { ModelsConsole } from "@/components/models-console";
import { Panel } from "@/components/panel";
import { listAvailableOllamaModels } from "@/lib/server/ollama";
import { getRuntimeStatusWithHealth } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ModelsPage() {
  noStore();
  const runtime = await getRuntimeStatusWithHealth();
  const inventory = await listAvailableOllamaModels(runtime.settings.modelBaseUrl);

  return (
    <div className="stack-lg">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Ollama</span>
          <h1>Models</h1>
          <p>
            Manage local Ollama downloads, browse the library catalog, and keep the daemon&apos;s
            configured model in view while you work.
          </p>
        </div>
      </div>

      <Panel
        title="Model Inventory"
        subtitle="Download new models, remove local ones you no longer need, and see which model the daemon is configured to use."
      >
        <ModelsConsole
          initialRuntime={runtime}
          initialModels={inventory.models}
          initialInstalledCount={inventory.installedCount}
          initialLibraryCount={inventory.libraryCount}
          initialRemoteLibraryCount={inventory.remoteLibraryCount}
          initialInstalledError={inventory.installedError}
          initialLibraryError={inventory.libraryError}
        />
      </Panel>
    </div>
  );
}
