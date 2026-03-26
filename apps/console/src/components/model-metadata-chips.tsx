import type { OllamaModelOption } from "@/lib/types";

interface ModelMetadataChipsProps {
  model: OllamaModelOption;
  showInstalledStatus?: boolean;
  showRemoteStatus?: boolean;
}

export function ModelMetadataChips({
  model,
  showInstalledStatus = false,
  showRemoteStatus = false,
}: ModelMetadataChipsProps) {
  const capabilities = Array.from(new Set(model.capabilities || []));

  return (
    <>
      {showInstalledStatus && model.installed ? (
        <span className="model-status-chip model-status-chip-installed">installed</span>
      ) : null}
      {showRemoteStatus && model.remoteOnly ? (
        <span className="model-status-chip model-status-chip-remote">remote</span>
      ) : null}
      {model.sizeLabel ? (
        <span className="model-meta-chip" title={`Parameter size ${model.sizeLabel}`}>
          {model.sizeLabel}
        </span>
      ) : null}
      {model.contextWindowLabel ? (
        <span
          className="model-meta-chip"
          title={`Context window ${model.contextWindowLabel}`}
        >
          {model.contextWindowLabel} ctx
        </span>
      ) : null}
      {capabilities.map((capability) => (
        <span key={`${model.name}-${capability}`} className="model-capability-chip">
          {capability}
        </span>
      ))}
    </>
  );
}
