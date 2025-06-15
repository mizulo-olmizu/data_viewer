import { useCallback } from "react";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
import { localPoint } from "@visx/event";

export function useChartTooltip<T>() {
  const { containerRef, TooltipInPortal } = useTooltipInPortal({
    scroll: true,
  });

  const {
    tooltipOpen,
    tooltipData,
    tooltipLeft,
    tooltipTop,
    showTooltip,
    hideTooltip,
  } = useTooltip<T>();

  const handleMouseMove = useCallback(
    (event: React.MouseEvent, data: T) => {
      const eventSvgCoords = localPoint(event);
      if (eventSvgCoords) {
        showTooltip({
          tooltipData: data,
          tooltipLeft: eventSvgCoords.x,
          tooltipTop: eventSvgCoords.y,
        });
      }
    },
    [showTooltip],
  );

  const handleMouseLeave = () => {
    hideTooltip();
  };

  return {
    tooltipOpen,
    tooltipData,
    tooltipLeft,
    tooltipTop,
    containerRef,
    TooltipInPortal,
    handleMouseMove,
    handleMouseLeave,
  };
}
