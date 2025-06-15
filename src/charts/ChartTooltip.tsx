import { ReactNode } from "react";
import { TooltipWithBounds, defaultStyles } from "@visx/tooltip";

export const tooltipStyles = {
  ...defaultStyles,
  backgroundColor: "rgba(53,71,125,0.8)",
  color: "white",
  padding: 12,
  witdh: 152,
  height: 72,
};

type ChartTooltipProps<T> = {
  tooltipOpen: boolean;
  tooltipData: T | null;
  tooltipLeft: number;
  tooltipTop: number;
  renderTooltipContent: (data: T) => ReactNode;
};

const tooltipTopOffset = 5;
const tooltipLeftOffset = 10;

export function ChartTooltip<T>({
  tooltipOpen,
  tooltipData,
  tooltipLeft,
  tooltipTop,
  renderTooltipContent,
}: ChartTooltipProps<T>) {
  if (!tooltipOpen || !tooltipData) return null;

  return (
    <TooltipWithBounds
      key={Math.random()} // needed for bounds to update correctly
      left={tooltipLeft + tooltipLeftOffset}
      top={tooltipTop + tooltipTopOffset}
      style={tooltipStyles}
    >
      {renderTooltipContent(tooltipData)}
    </TooltipWithBounds>
  );
}
