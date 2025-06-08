import { useState, useMemo, useEffect } from "react";
import { Bar } from "@visx/shape";
import { Group } from "@visx/group";
import { GradientTealBlue } from "@visx/gradient";
import { scaleLinear, scaleBand } from "@visx/scale";
import { useChartTooltip } from "./useChartTooltip";
import { ChartTooltip } from "./ChartTooltip";
import { ValueCount } from "../types";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import { ParentSize } from "@visx/responsive";
import { AxisBottom, AxisLeft } from "@visx/axis";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import { Margin } from "../types";

export type ValueCountsChartInteractiveProps = {
  data: ValueCount[];
  width?: number | string;
  height: number | string;
  onClick?: () => void;
  otherIndex?: number;
  detail?: boolean;
  margin?: Margin;
};

export function ValueCountsChartInteractive({
  data,
  width = "100%",
  height,
  onClick,
  detail = false,
  otherIndex,
  margin = { top: 50, right: 50, bottom: 50, left: 100 },
}: ValueCountsChartInteractiveProps) {
  if (data.length === 0) return null;

  const [checked, setChecked] = useState(data.map((_, i) => i));

  useEffect(() => {
    setChecked(data.map((_, i) => i));
  }, [data]);

  const handleToggle = (value: number) => () => {
    const currentIndex = checked.indexOf(value);
    const newChecked = [...checked];

    if (currentIndex === -1) {
      newChecked.push(value);
    } else {
      newChecked.splice(currentIndex, 1);
    }

    setChecked(newChecked);
  };

  return (
    <Stack direction="row" spacing={2} sx={{ width: width, height: height }}>
      <Box flexGrow={1} overflow="hidden" height="100%">
        <ParentSize debounceTime={10}>
          {(parent) => (
            <>
              <ValueCountsChart
                data={data.filter((_, i) => checked.includes(i))}
                width={parent.width}
                height={parent.height}
                onClick={onClick}
                axis={true}
                otherIndex={otherIndex}
                margin={margin}
              />
            </>
          )}
        </ParentSize>
      </Box>
      {detail && (
        <List sx={{ maxWidth: 250, overflow: "auto" }}>
          <ListItem key={"all-check"} disablePadding>
            <ListItemButton
              role={undefined}
              onClick={() => {
                if (checked.length === data.length) {
                  setChecked([]);
                } else {
                  setChecked(data.map((_, i) => i));
                }
              }}
              dense
            >
              <Checkbox
                edge="start"
                checked={checked.length === data.length}
                tabIndex={-1}
                disableRipple
              />
              <ListItemText
                id={`checkbox-list-label-all`}
                primary="Select All"
              />
            </ListItemButton>
          </ListItem>
          <Divider />
          {data.map((d, i) => {
            const labelId = `checkbox-list-label-${i}`;

            return (
              <ListItem key={i} disablePadding>
                <ListItemButton
                  role={undefined}
                  onClick={handleToggle(i)}
                  dense
                >
                  <Checkbox
                    edge="start"
                    checked={checked.includes(i)}
                    tabIndex={-1}
                    disableRipple
                  />
                  <ListItemText id={labelId} primary={d.value} />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      )}
    </Stack>
  );
}

export type ValueCountsChartProps = {
  data: ValueCount[];
  width: number;
  height: number;
  onClick?: () => void;
  otherIndex?: number;
  axis?: boolean;
  margin?: Margin;
};

export function ValueCountsChart({
  data,
  width,
  height,
  onClick,
  axis = false,
  otherIndex,
  margin = { top: 30, right: 15, bottom: 30, left: 15 },
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

  const xMax = width - margin.left - margin.right;
  const yMax = height - margin.top - margin.bottom;

  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        range: [0, xMax],
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
        <Group top={margin.top} left={margin.left}>
          {data.map((d, i) => {
            const barWidth = xScale(d.count ?? 0);
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
              />
            );
          })}
          {axis && (
            <>
              <AxisLeft scale={yScale} />
              <AxisBottom scale={xScale} top={yMax} />
            </>
          )}
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
