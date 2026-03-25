declare module "plotly.js-dist-min" {
  const plotly: unknown;
  export default plotly;
}

declare module "react-plotly.js/factory" {
  import type { ComponentType } from "react";

  export default function createPlotlyComponent(
    plotly: unknown,
  ): ComponentType<Record<string, unknown>>;
}
