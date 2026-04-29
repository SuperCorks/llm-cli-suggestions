import {
  AudioLines,
  Brain,
  Eye,
  type LucideIcon,
  Sparkles,
  Wrench,
} from "lucide-react";

import type { OllamaModelOption } from "@/lib/types";

interface ModelMetadataChipsProps {
  model: OllamaModelOption;
  showInstalledStatus?: boolean;
  showRemoteStatus?: boolean;
}

type CapabilityPresentation = {
  icon: LucideIcon;
  label: string;
};

const KNOWN_CAPABILITY_PRESENTATIONS: Record<string, CapabilityPresentation> = {
  audio: {
    icon: AudioLines,
    label: "audio",
  },
  thinking: {
    icon: Brain,
    label: "thinking",
  },
  reasoning: {
    icon: Brain,
    label: "thinking",
  },
  vision: {
    icon: Eye,
    label: "vision",
  },
  tools: {
    icon: Wrench,
    label: "tools",
  },
  tool: {
    icon: Wrench,
    label: "tools",
  },
  embedding: {
    icon: Sparkles,
    label: "embedding",
  },
};

function renderCapabilityChip(modelName: string, capability: string) {
  const normalized = capability.trim().toLowerCase();
  const presentation = KNOWN_CAPABILITY_PRESENTATIONS[normalized];

  if (!presentation) {
    return (
      <span key={`${modelName}-${capability}`} className="model-capability-chip">
        {capability}
      </span>
    );
  }

  const Icon = presentation.icon;
  return (
    <span
      key={`${modelName}-${capability}`}
      className="model-capability-chip model-capability-chip-icon"
      title={presentation.label}
      aria-label={presentation.label}
      data-capability={presentation.label}
    >
      <Icon aria-hidden="true" className="model-capability-icon" />
      <span className="visually-hidden">{presentation.label}</span>
    </span>
  );
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
      {capabilities.map((capability) => renderCapabilityChip(model.name, capability))}
    </>
  );
}
