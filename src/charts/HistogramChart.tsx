import { useMemo, useState, useEffect } from "react";
import { Bar } from "@visx/shape";
import { Group } from "@visx/group";
import { GradientTealBlue } from "@visx/gradient";
import { scaleLinear, scaleUtc, coerceNumber } from "@visx/scale";
import { useChartTooltip } from "./useChartTooltip";
import { ChartTooltip } from "./ChartTooltip";
import { formatNumber } from "../utils";
import { AxisBottom, AxisLeft } from "@visx/axis";
import Slider from "@mui/material/Slider";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { ParentSize } from "@visx/responsive";
import TextField from "@mui/material/TextField";
import { Margin } from "../types";

export type HistogramChartInteractiveProps = {
  data: (number | Date)[];
  width?: number | string;
  height: number | string;
  onClick?: () => void;
  detail?: boolean;
  margin?: Margin;
};

const getMinMax = (vals: (number | { valueOf(): number })[]) => {
  const numericVals = vals.map(coerceNumber);
  return [Math.min(...numericVals), Math.max(...numericVals)];
};

export function HistogramChartInteractive({
  data,
  width = "100%",
  height,
  onClick,
  detail = false,
  margin = { top: 50, right: 50, bottom: 50, left: 80 },
}: HistogramChartInteractiveProps) {
  if (data.length === 0) return null;

  const initialRange = getMinMax(data);

  const [filteredData, setFilteredData] = useState(data);
  const [binCount, setBinCount] = useState<number>(sturgesFormula(data.length));
  const [range, setRange] = useState<number[]>(initialRange);
  const [filteredRange, setFilteredRange] = useState<number[]>(initialRange);

  // 元データが更新されたときに各値を更新
  // 明示的に更新しないと、更新されない
  useEffect(() => {
    setFilteredData(data);
    setBinCount(sturgesFormula(data.length));

    const newRange = getMinMax(data);
    setRange(newRange);
    setFilteredRange(newRange);
  }, [data]);

  return (
    <Stack
      direction="column"
      spacing={2}
      alignItems="center"
      sx={{ width: width, height: height }}
    >
      <Box flexGrow={1} overflow="hidden" width="100%">
        <ParentSize debounceTime={10}>
          {(parent) => (
            <>
              <HistogramChart
                data={filteredData}
                width={parent.width}
                height={parent.height}
                onClick={onClick}
                axis={true}
                binCount={binCount}
                margin={margin}
              />
            </>
          )}
        </ParentSize>
      </Box>
      {detail && (
        <Stack
          direction="column"
          spacing={1}
          alignItems="flex-end"
          width="100%"
          sx={{ px: 2 }}
        >
          <Slider
            value={filteredRange}
            onChange={(_, newRange) => {
              setFilteredRange(newRange);
              setFilteredData(
                data.filter((d) => {
                  if (d instanceof Date) {
                    return (
                      newRange[0] <= d.getTime() && d.getTime() <= newRange[1]
                    );
                  } else {
                    return newRange[0] <= d && d <= newRange[1];
                  }
                }),
              );
            }}
            valueLabelDisplay="auto"
            valueLabelFormat={(value) =>
              data[0] instanceof Date ? String(new Date(value)) : String(value)
            }
            min={range[0]}
            max={range[1]}
          />
          <TextField
            id="standard-number"
            label="Bin Count"
            type="number"
            variant="standard"
            value={binCount}
            onChange={(e) => {
              setBinCount(Number(e.target.value));
            }}
            slotProps={{
              inputLabel: {
                shrink: true,
              },
            }}
          />
        </Stack>
      )}
    </Stack>
  );
}

type HistogramChartProps = {
  data: (number | Date)[];
  width: number;
  height: number;
  onClick?: () => void;
  axis?: boolean;
  binCount?: number | null;
  margin?: Margin;
};

export function HistogramChart({
  data,
  width,
  height,
  onClick,
  axis = false,
  binCount,
  margin = { top: 30, right: 15, bottom: 30, left: 15 },
}: HistogramChartProps) {
  if (data.length === 0) return null;

  const {
    tooltipOpen,
    tooltipData,
    tooltipLeft,
    tooltipTop,
    containerRef,
    handleMouseMove,
    handleMouseLeave,
  } = useChartTooltip<HistogramBin<number | Date>>();

  const xMax = width - margin.left - margin.right;
  const yMax = height - margin.top - margin.bottom;

  const bins = useMemo(() => binData(data, binCount), [data, binCount]);

  // DateとnumberでxScaleを使い分ける
  const xScale = useMemo(() => {
    if (data[0] instanceof Date) {
      return scaleUtc({
        range: [0, xMax],
        round: true,
        domain: getMinMax(data),
      });
    } else {
      return scaleLinear({
        range: [0, xMax],
        round: true,
        domain: getMinMax(data),
      });
    }
  }, [data, binCount, xMax]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        range: [yMax, 0],
        round: true,
        domain: [0, Math.max(...bins.map((bin) => bin.count))],
      }),
    [data, binCount, yMax],
  );

  const barWidth = xMax / bins.length;

  return width < 10 ? null : (
    <div style={{ position: "relative" }} onClick={onClick}>
      <svg ref={containerRef} width={width} height={height}>
        <GradientTealBlue id="teal" />
        <rect width={width} height={height} fill="url(#teal)" rx={14} />
        <Group top={margin.top} left={margin.left}>
          {bins.map((bin, i) => {
            if (bin.count == 0) return;

            const barX = bins.length == 1 ? 0 : xScale(bin.range[0]);
            const barHeight = Math.max(0, yMax - yScale(bin.count)); // scaleでroundをtrueにしていると、countが小さすぎるときにheightがマイナスの値になってしまう
            const barY = yMax - barHeight;

            return (
              <Bar
                key={`bar-${i}`}
                x={barX}
                y={barY}
                width={barWidth}
                height={barHeight}
                fill="rgba(23, 233, 217, .5)"
                stroke="rgba(23, 233, 217, 1)"
                onMouseMove={(event) => handleMouseMove(event, bin)}
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
        renderTooltipContent={(bin) => {
          if (bin === undefined) return <></>;
          return (
            <div style={{ textAlign: "left" }}>
              <div>{`Range: ${typeof bin.range[0] == "number" ? formatNumber(bin.range[0], 7) : bin.range[0]}~${typeof bin.range[1] == "number" ? formatNumber(bin.range[1], 7) : bin.range[1]}`}</div>
              <div>{`Count: ${bin.count}`}</div>
              <div>{`Props: ${((bin.count / data.length) * 100).toFixed(1)}%`}</div>
            </div>
          );
        }}
      />
    </div>
  );
}

interface HistogramBin<T> {
  range: [T, T];
  count: number;
}

const sturgesFormula = (n: number) => Math.ceil(Math.log2(n) + 1);

function binData<T extends number | Date>(
  data: T[],
  binCount: number | null = null,
): HistogramBin<T>[] {
  if (data.length === 0) return [];

  // Date 型はnumberに変換する
  const toNumber = (value: T): number =>
    value instanceof Date ? value.getTime() : value;

  const fromNumber = (num: number): T =>
    (data[0] instanceof Date ? new Date(num) : num) as T;

  const numericData = data.map(toNumber);
  const n = numericData.length;

  binCount = binCount ?? sturgesFormula(n);

  const min = Math.min(...numericData);
  const max = Math.max(...numericData);
  const binWidth = (max - min) / binCount;

  const bins: HistogramBin<T>[] = [];

  // ビンの初期化
  for (let i = 0; i < binCount; i++) {
    const start = min + i * binWidth;
    const end = i === binCount - 1 ? max : start + binWidth;
    bins.push({
      range: [fromNumber(start), fromNumber(end)],
      count: 0,
    });
  }

  // データをビンに振り分け
  for (const originalValue of data) {
    const value = toNumber(originalValue);
    for (let i = 0; i < bins.length; i++) {
      const [start, end] = bins[i].range.map(toNumber);
      const isLastBin = i === bins.length - 1;
      if ((value >= start && value < end) || (isLastBin && value === end)) {
        bins[i].count++;
        break;
      }
    }
  }

  return bins;
}
