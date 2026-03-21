import { Panel } from "@/components/panel";
import { RankingInspector } from "@/components/ranking-inspector";
import { getResolvedRuntimeSettings } from "@/lib/server/config";

export const dynamic = "force-dynamic";

export default function RankingPage() {
  const settings = getResolvedRuntimeSettings();

  return (
    <div className="stack-lg">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Debug</span>
          <h1>Ranking Inspector</h1>
          <p>Replay a prompt context, inspect the candidate set, and see why the engine chose a winner.</p>
        </div>
      </div>

      <Panel
        title="Inspect A Decision"
        subtitle="This talks to the local daemon inspect endpoint and returns score breakdowns, prompt context, and raw model output."
      >
        <RankingInspector
          defaultModelName={settings.modelName}
          defaultModelBaseUrl={settings.modelBaseUrl}
          defaultSuggestStrategy={settings.suggestStrategy}
        />
      </Panel>
    </div>
  );
}
