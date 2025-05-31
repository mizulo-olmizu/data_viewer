import React, { useRef } from "react";
import { tooltipStyles } from "./useChartTooltip";

type ChartTooltipProps<T> = {
  tooltipOpen: boolean;
  tooltipData: T | null;
  tooltipLeft: number | null;
  tooltipTop: number | null;
  renderTooltipContent: (data: T) => React.ReactNode;
};

const tooltipTopOffset = 15;
const tooltipLeftOffset = 15;

export function ChartTooltip<T>({
  tooltipOpen,
  tooltipData,
  tooltipLeft,
  tooltipTop,
  renderTooltipContent,
}: ChartTooltipProps<T>) {
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  if (!tooltipOpen || !tooltipData) return null;

  return (
    <div
      ref={tooltipRef}
      style={{
        position: "absolute",
        top: (tooltipTop ?? 0) + tooltipTopOffset,
        left: (tooltipLeft ?? 0) + tooltipLeftOffset,
        pointerEvents: "none",
        ...tooltipStyles,
      }}
    >
      {renderTooltipContent(tooltipData)}
    </div>
  );
}
