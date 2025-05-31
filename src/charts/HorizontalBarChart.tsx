import { useMemo } from "react";
import { Bar } from "@visx/shape";
import { Group } from "@visx/group";
import { GradientTealBlue } from "@visx/gradient";
import { scaleLinear, scaleBand } from "@visx/scale";

export interface BarChartDatum {
  x: number;
  y: string;
}

export type BarChartProps = {
  data: BarChartDatum[];
  width: number;
  height: number;
  otherIndex?: number;
  events?: boolean;
  verticalMargin?: number;
  horizontalMargin?: number;
};

export default function HorizontalBarChart({
  data,
  width,
  height,
  otherIndex,
  events = false,
  verticalMargin = 60,
  horizontalMargin = 30,
}: BarChartProps) {
  if (data.length === 0) return null;

  const xMax = width - horizontalMargin;
  const yMax = height - verticalMargin;

  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        range: [xMax, 0],
        round: true,
        domain: [0, Math.max(...data.map((d) => d.x))],
      }),
    [data, xMax],
  );

  const yScale = useMemo(
    () =>
      scaleBand<string>({
        range: [0, yMax],
        round: true,
        domain: data.map((d) => d.y),
        padding: 0.4,
      }),
    [data, yMax],
  );

  return width < 10 ? null : (
    <svg width={width} height={height}>
      <GradientTealBlue id="teal" />
      <rect width={width} height={height} fill="url(#teal)" rx={14} />
      <Group top={verticalMargin / 2} left={horizontalMargin / 2}>
        {data.map((d, i) => {
          const barWidth = xMax - xScale(d.x);
          const barHeight = yScale.bandwidth();
          const barX = 0;
          const barY = yScale(d.y);
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
              onClick={() => {
                if (events)
                  alert(`clicked: ${JSON.stringify(Object.values(d))}`);
              }}
            />
          );
        })}
      </Group>
    </svg>
  );
}
