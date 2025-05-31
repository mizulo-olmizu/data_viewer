import { useMemo } from "react";
import { Bar } from "@visx/shape";
import { Group } from "@visx/group";
import { GradientTealBlue } from "@visx/gradient";
import { scaleLinear, scaleBand } from "@visx/scale";
import { useChartTooltip } from "./useChartTooltip";
import { ChartTooltip } from "./ChartTooltip";
import { ValueCount } from "../types";

export type ValueCountsChartProps = {
  data: ValueCount[];
  width: number;
  height: number;
  onClick?: () => void;
  otherIndex?: number;
  events?: boolean;
  verticalMargin?: number;
  horizontalMargin?: number;
};

export default function ValueCountsChart({
  data,
  width,
  height,
  onClick,
  otherIndex,
  events = false,
  verticalMargin = 60,
  horizontalMargin = 30,
}: ValueCountsChartProps) {
  if (data.length === 0) return null;

  const allCounts = data.reduce((sum, d) => sum + (d.count ?? 0), 0);

  const {
    tooltipOpen,
    tooltipData,
    tooltipLeft,
    tooltipTop,
    containerRef,
    handleMouseMove,
    handleMouseLeave,
  } = useChartTooltip<ValueCount>();

  const xMax = width - horizontalMargin;
  const yMax = height - verticalMargin;

  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        range: [xMax, 0],
        round: true,
        domain: [0, Math.max(...data.map((d) => d.count ?? 0))],
      }),
    [data, xMax],
  );

  const yScale = useMemo(
    () =>
      scaleBand<string>({
        range: [0, yMax],
        round: true,
        domain: data.map((d) => d.value),
        padding: 0.4,
      }),
    [data, yMax],
  );

  return width < 10 ? null : (
    <div style={{ position: "relative" }} onClick={onClick}>
      <svg ref={containerRef} width={width} height={height}>
        <GradientTealBlue id="teal" />
        <rect width={width} height={height} fill="url(#teal)" rx={14} />
        <Group top={verticalMargin / 2} left={horizontalMargin / 2}>
          {data.map((d, i) => {
            const barWidth = xMax - xScale(d.count ?? 0);
            const barHeight = yScale.bandwidth();
            const barX = 0;
            const barY = yScale(d.value);
            return (
              <Bar
                key={`bar-${i}`}
                x={barX}
                y={barY}
                width={barWidth}
                height={barHeight}
                fill={
                  otherIndex && i == otherIndex
                    ? "rgba(169, 169, 169, .5)"
                    : "rgba(23, 233, 217, .5)"
                }
                stroke={
                  otherIndex && i == otherIndex
                    ? "rgba(169, 169, 169, 1)"
                    : "rgba(23, 233, 217, 1)"
                }
                onMouseMove={(event) => handleMouseMove(event, d)}
                onMouseLeave={handleMouseLeave}
                onClick={() => {
                  if (events)
                    alert(`clicked: ${JSON.stringify(Object.values(d))}`);
                }}
              />
            );
          })}
        </Group>
      </svg>
      <ChartTooltip
        tooltipOpen={tooltipOpen}
        tooltipData={tooltipData}
        tooltipLeft={tooltipLeft ?? null}
        tooltipTop={tooltipTop ?? null}
        renderTooltipContent={(d) => {
          if (d === undefined) return <></>;
          return (
            <div style={{ textAlign: "left" }}>
              <div>{`Value: ${d.value}`}</div>
              <div>{`Count: ${d.count}`}</div>
              <div>{`Props: ${(((d.count ?? 0) / allCounts) * 100).toFixed(2)}`}</div>
            </div>
          );
        }}
      />
    </div>
  );
}
