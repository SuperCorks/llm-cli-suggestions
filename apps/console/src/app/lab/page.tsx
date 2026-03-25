import { unstable_noStore as noStore } from "next/cache";

import { LabConsole } from "@/components/lab-console";
import { Panel } from "@/components/panel";
import { listAvailableOllamaModels } from "@/lib/server/ollama";
import { listBenchmarkRuns } from "@/lib/server/queries";
import { getRuntimeStatusWithHealth } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LabPage() {
  noStore();
  const runtime = await getRuntimeStatusWithHealth();
  const activeModel = runtime.health.ok ? runtime.health.modelName : runtime.settings.modelName;
  const runs = listBenchmarkRuns(20);
  const modelInventory = await listAvailableOllamaModels(runtime.settings.modelBaseUrl);

  return (
    <div className="stack-lg">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Evaluation</span>
          <h1>Model Lab</h1>
          <p>Compare installed models, save benchmark runs, and test prompt contexts without touching your shell.</p>
        </div>
      </div>

      <Panel
        title="Benchmarks And Ad-Hoc Tests"
        subtitle="Run static, replay, and raw benchmark tracks in the background and save rich timing and quality results to SQLite for later comparison."
      >
        <LabConsole
          initialRuns={runs}
          defaultModel={activeModel}
          defaultSuggestStrategy={runtime.settings.suggestStrategy}
          availableModels={modelInventory.models}
          inventorySummary={modelInventory}
        />
      </Panel>
    </div>
  );
}
