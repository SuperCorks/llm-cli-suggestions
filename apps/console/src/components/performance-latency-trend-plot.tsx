"use client";

import dynamic from "next/dynamic";
import type { CSSProperties, ComponentType } from "react";

import type { PerformanceDashboardData } from "@/lib/server/performance";

type PlotComponentProps = {
  className?: string;
  config?: Record<string, unknown>;
  data: Array<Record<string, unknown>>;
  layout: Record<string, unknown>;
  style?: CSSProperties;
  useResizeHandler?: boolean;
};

const Plot = dynamic<PlotComponentProps>(
  async () => {
    const [{ default: createPlotlyComponent }, plotlyModule] = await Promise.all([
      import("react-plotly.js/factory"),
      import("plotly.js-dist-min"),
    ]);
    const plotly = ("default" in plotlyModule ? plotlyModule.default : plotlyModule) as unknown;
    return createPlotlyComponent(plotly) as ComponentType<PlotComponentProps>;
  },
  {
    ssr: false,
    loading: () => <div className="performance-plot-skeleton" aria-hidden="true" />,
  },
);

export function PerformanceLatencyTrendPlot({
  points,
  bucketLabelFormat,
}: {
  points: PerformanceDashboardData["timeline"]["points"];
  bucketLabelFormat: PerformanceDashboardData["timeline"]["bucketLabelFormat"];
}) {
  const activePoints = points.filter((point) => point.count > 0);

  if (activePoints.length === 0) {
    return <p className="helper-text">No timed requests landed in the selected window.</p>;
  }

  const xValues = points.map((point) => new Date(point.timestampMs).toISOString());
  const averageValues = points.map((point) => (point.count > 0 ? point.avgLatencyMs : null));
  const p95Values = points.map((point) => (point.count > 0 ? point.p95LatencyMs : null));
  const coldValues = points.map((point) =>
    point.count > 0 ? point.coldAvgLatencyMs : null,
  );
  const hotValues = points.map((point) =>
    point.count > 0 ? point.hotAvgLatencyMs : null,
  );

  function buildTrace({
    values,
    name,
    color,
    width,
    dash,
    markerSize,
  }: {
    values: Array<number | null>;
    name: string;
    color: string;
    width: number;
    dash?: string;
    markerSize: number;
  }) {
    return {
      x: xValues,
      y: values,
      type: "scatter",
      mode: "lines+markers",
      name,
      line: { color, width, dash, shape: "linear" },
      marker: {
        size: markerSize,
        color,
        line: {
          width: 1.5,
          color: "#1a1a1a",
        },
      },
      connectgaps: true,
      hovertemplate: "%{y:.0f} ms<extra></extra>",
    } satisfies Record<string, unknown>;
  }

  const series: Array<Record<string, unknown>> = [
    buildTrace({
      values: p95Values,
      name: "P95",
      color: "#f3c47d",
      width: 1.8,
      markerSize: 7,
    }),
    buildTrace({
      values: averageValues,
      name: "Average",
      color: "#b3c8e7",
      width: 1.8,
      markerSize: 7,
    }),
  ];

  if (coldValues.some((value) => value !== null)) {
    series.push(
      buildTrace({
        values: coldValues,
        name: "Cold avg.",
        color: "#eabf74",
        width: 1.4,
        dash: "dot",
        markerSize: 5,
      }),
    );
  }

  if (hotValues.some((value) => value !== null)) {
    series.push(
      buildTrace({
        values: hotValues,
        name: "Hot avg.",
        color: "#8bd39f",
        width: 1.4,
        dash: "dot",
        markerSize: 5,
      }),
    );
  }

  const tickformatstops =
    bucketLabelFormat === "hour"
      ? [
          { dtickrange: [null, 3_600_000], value: "%-I %p" },
          { dtickrange: [3_600_000, 86_400_000], value: "%-I %p<br>%b %-d" },
          { dtickrange: [86_400_000, null], value: "%b %-d" },
        ]
      : [
          { dtickrange: [null, 86_400_000], value: "%-I %p<br>%b %-d" },
          { dtickrange: [86_400_000, 2_678_400_000], value: "%b %-d" },
          { dtickrange: [2_678_400_000, null], value: "%b %-d, %Y" },
        ];

  return (
    <div className="performance-chart-shell">
      <Plot
        className="performance-plot"
        data={series}
        layout={{
          autosize: true,
          hovermode: "x unified",
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          margin: { l: 52, r: 16, t: 12, b: 56 },
          showlegend: true,
          legend: {
            orientation: "h",
            x: 0,
            y: 1.16,
            xanchor: "left",
            yanchor: "bottom",
            bgcolor: "rgba(0, 0, 0, 0)",
            font: { color: "#8e9197", size: 12 },
          },
          hoverlabel: {
            bgcolor: "#12161d",
            bordercolor: "rgba(179, 200, 231, 0.18)",
            font: { color: "#f5f7fb", size: 12 },
          },
          xaxis: {
            type: "date",
            automargin: true,
            showgrid: false,
            showline: false,
            zeroline: false,
            showspikes: true,
            spikemode: "across",
            spikesnap: "hovered data",
            spikedash: "dot",
            spikethickness: 1,
            spikecolor: "rgba(229, 226, 225, 0.45)",
            ticks: "outside",
            ticklen: 6,
            tickcolor: "rgba(142, 145, 151, 0.22)",
            tickfont: { color: "#8e9197", size: 12 },
            hoverformat:
              bucketLabelFormat === "hour" ? "%b %-d, %-I:%M %p" : "%b %-d, %Y",
            tickformatstops,
          },
          yaxis: {
            automargin: true,
            rangemode: "tozero",
            showline: false,
            zeroline: false,
            gridcolor: "rgba(142, 145, 151, 0.14)",
            tickfont: { color: "#8e9197", size: 12 },
            ticksuffix: " ms",
          },
        }}
        config={{
          displayModeBar: false,
          responsive: true,
        }}
        style={{ width: "100%", height: 340 }}
        useResizeHandler
      />
    </div>
  );
}

export function PerformanceLatencyDistributionPlot({
  rows,
}: {
  rows: PerformanceDashboardData["histogram"];
}) {
  const xValues = rows.map((_, index) => index);
  const tickText = rows.map((row) => row.label);
  const yValues = rows.map((row) => row.count);
  const customData = rows.map((row) => [
    row.coldCount,
    row.hotCount,
    row.unknownCount,
    row.notApplicableCount,
  ]);
  const annotations = rows.map((row, index) => ({
    x: index,
    y: row.count,
    text: String(row.count),
    showarrow: false,
    yshift: 12,
    font: {
      color: "#e5e2e1",
      size: 12,
    },
  }));

  return (
    <div className="performance-chart-shell">
      <Plot
        className="performance-plot"
        data={[
          {
            x: xValues,
            y: yValues,
            type: "bar",
            name: "Requests",
            width: 0.82,
            customdata: customData,
            marker: {
              color: "rgba(179, 200, 231, 0.34)",
              line: {
                color: "#b3c8e7",
                width: 1,
              },
            },
            hovertemplate:
              "%{x}<br>Total: %{y}" +
              "<br>Cold: %{customdata[0]}" +
              "<br>Hot: %{customdata[1]}" +
              "<br>Unknown: %{customdata[2]}" +
              "<br>No model: %{customdata[3]}<extra></extra>",
          },
        ]}
        layout={{
          autosize: true,
          bargap: 0.18,
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          margin: { l: 52, r: 16, t: 20, b: 72 },
          showlegend: false,
          annotations,
          hoverlabel: {
            bgcolor: "#12161d",
            bordercolor: "rgba(179, 200, 231, 0.18)",
            font: { color: "#f5f7fb", size: 12 },
          },
          xaxis: {
            type: "linear",
            automargin: true,
            showgrid: false,
            showline: false,
            zeroline: false,
            tickfont: { color: "#8e9197", size: 12 },
            tickmode: "array",
            tickvals: xValues,
            ticktext: tickText,
            range: [-0.5, Math.max(rows.length - 0.5, 0.5)],
          },
          yaxis: {
            automargin: true,
            rangemode: "tozero",
            showline: false,
            zeroline: false,
            gridcolor: "rgba(142, 145, 151, 0.14)",
            tickfont: { color: "#8e9197", size: 12 },
            tickmode: "auto",
            nticks: 6,
            tickformat: ",d",
          },
        }}
        config={{
          displayModeBar: false,
          responsive: true,
        }}
        style={{ width: "100%", height: 340 }}
        useResizeHandler
      />
      <div className="performance-chart-legend">
        <span className="performance-legend">
          <span
            className="performance-legend-dot"
            style={{ background: "rgba(179, 200, 231, 0.74)" }}
            aria-hidden="true"
          />
          Total requests
        </span>
        <span className="helper-text">Hover a bar to inspect cold, hot, unknown, and no-model mix.</span>
      </div>
    </div>
  );
}
