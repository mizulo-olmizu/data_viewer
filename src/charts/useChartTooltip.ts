import { useTooltip, useTooltipInPortal, defaultStyles } from "@visx/tooltip";
import { localPoint } from "@visx/event";

export const tooltipStyles = {
  ...defaultStyles,
  backgroundColor: "rgba(53,71,125,0.8)",
  color: "white",
  padding: 12,
};

export function useChartTooltip<T>() {
  const {
    tooltipOpen,
    tooltipData,
    tooltipLeft,
    tooltipTop,
    showTooltip,
    hideTooltip,
  } = useTooltip<T>();

  const { containerRef, TooltipInPortal } = useTooltipInPortal({
    scroll: true,
  });

  const handleMouseMove = (event: React.MouseEvent, data: T) => {
    const eventSvgCoords = localPoint(event);
    if (eventSvgCoords) {
      showTooltip({
        tooltipData: data,
        tooltipLeft: eventSvgCoords.x,
        tooltipTop: eventSvgCoords.y,
      });
    }
  };

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
