import { unstable_noStore as noStore } from "next/cache";

import { Panel } from "@/components/panel";
import { RankingInspector } from "@/components/ranking-inspector";
import { getResolvedRuntimeSettings } from "@/lib/server/config";
import { listAvailableOllamaModels } from "@/lib/server/ollama";
import { normalizeSuggestStrategy } from "@/lib/suggest-strategy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function InspectorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();
  const settings = getResolvedRuntimeSettings();
  const modelInventory = await listAvailableOllamaModels(settings.modelBaseUrl);
  const params = await searchParams;

  return (
    <div className="stack-lg">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Debug</span>
          <h1>Inspector</h1>
          <p>Replay a saved or ad-hoc prompt context, inspect the candidate set, and see why the engine chose a winner.</p>
        </div>
      </div>

      <Panel
        title="Inspect A Decision"
        subtitle="This talks to the local daemon inspect endpoint and returns score breakdowns, prompt snapshots, retrieved context, and raw model output."
      >
        <RankingInspector
          defaultModelName={settings.modelName}
          defaultFastModelName={settings.fastModelName}
          defaultSuggestStrategy={settings.suggestStrategy}
          availableModels={modelInventory.models}
          inventorySummary={modelInventory}
          initialForm={{
            sessionId: getString(params.session),
            buffer: getString(params.buffer),
            cwd: getString(params.cwd),
            repoRoot: getString(params.repo),
            branch: getString(params.branch),
            lastExitCode: getString(params.lastExitCode),
            fastModelName: getString(params.fastModel),
            modelName: getString(params.model),
            suggestStrategy: getString(params.strategy)
              ? normalizeSuggestStrategy(getString(params.strategy))
              : settings.suggestStrategy,
            recentCommands: getString(params.recentCommands),
          }}
          autoInspect={getString(params.auto) === "1"}
        />
      </Panel>
    </div>
  );
}
