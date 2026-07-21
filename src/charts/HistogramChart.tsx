import { useMemo, useState } from "react";
import { Bar } from "@visx/shape";
import { Group } from "@visx/group";
import { GradientTealBlue } from "@visx/gradient";
import { scaleLinear, scaleUtc, coerceNumber } from "@visx/scale";
import { useChartTooltip } from "./useChartTooltip";
import { ChartTooltip } from "./ChartTooltip";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Slider } from "@/components/ui/slider";
import { ParentSize } from "@visx/responsive";
import { Margin, NumericBin } from "../types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type HistogramChartInteractiveProps = {
  data: number[];
  width?: number | string;
  height: number | string;
  onClick?: () => void;
  detail?: boolean;
  margin?: Margin;
  toTemporal?: boolean;
  formatter?: (i: number) => string;
};

const getMinMax = (vals: (number | { valueOf(): number })[]) => {
  const numericVals = vals.map(coerceNumber);
  return [Math.min(...numericVals), Math.max(...numericVals)];
};

export function HistogramChartInteractive({
  data,
  onClick,
  detail = false,
  margin = { top: 50, right: 50, bottom: 50, left: 80 },
  toTemporal = false,
  formatter = (i: number) => String(i),
}: HistogramChartInteractiveProps) {
  const initialRange = data.length === 0 ? [0, 0] : getMinMax(data);

  const [prevData, setPrevData] = useState(data);
  const [filteredData, setFilteredData] = useState(data);
  const [binCount, setBinCount] = useState<number>(sturgesFormula(data.length));
  const [range, setRange] = useState<number[]>(initialRange);
  const [filteredRange, setFilteredRange] = useState<number[]>(initialRange);

  // 元データが更新されたときに各値を更新
  if (data !== prevData) {
    setPrevData(data);
    setFilteredData(data);
    setBinCount(sturgesFormula(data.length));

    const newRange = data.length === 0 ? [0, 0] : getMinMax(data);
    setRange(newRange);
    setFilteredRange(newRange);
  }

  if (data.length === 0) return null;

  const bins = binData(filteredData, binCount);

  const sliderDivisions = 50;
  const sliderStep = (range[1] - range[0]) / sliderDivisions;

  return (
    <div className="flex flex-col gap-2 items-center w-full h-full">
      <div className="grow overflow-hidden w-full">
        <ParentSize debounceTime={10}>
          {(parent) => (
            <>
              <HistogramChart
                bins={bins}
                width={parent.width}
                height={parent.height}
                onClick={onClick}
                axis={true}
                margin={margin}
                toTemporal={toTemporal}
                formatter={formatter}
              />
            </>
          )}
        </ParentSize>
      </div>
      {detail && (
        <div className="flex flex-col gap-1 items-end w-full px-2">
          <Slider
            value={filteredRange}
            onValueChange={(value) => {
              setFilteredRange(value);
              setFilteredData(
                data.filter((d) => {
                  return value[0] <= d && d <= value[1];
                }),
              );
            }}
            min={range[0]}
            max={range[1]}
            step={sliderStep}
          />
          <div className="flex items-center">
            <Label className="mr-2">Bin count</Label>
            <Input
              className="w-30"
              type="number"
              value={binCount}
              onChange={(e) => {
                setBinCount(Number(e.target.value));
              }}
              min={1}
            />
          </div>
        </div>
      )}
    </div>
  );
}

type HistogramChartProps = {
  bins: NumericBin[];
  width: number;
  height: number;
  onClick?: () => void;
  axis?: boolean;
  margin?: Margin;
  toTemporal?: boolean;
  formatter?: (i: number) => string;
};

export function HistogramChart({
  bins,
  width,
  height,
  onClick,
  axis = false,
  margin = { top: 30, right: 15, bottom: 30, left: 15 },
  toTemporal = false,
  formatter = (i: number) => String(i),
}: HistogramChartProps) {
  const {
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
    containerRef,
    handleMouseMove,
    handleMouseLeave,
  } = useChartTooltip<NumericBin>();

  const xMax = width - margin.left - margin.right;
  const yMax = height - margin.top - margin.bottom;

  const xScale = useMemo(
    () =>
      bins.length === 0
        ? null
        : toTemporal
          ? scaleUtc({
              range: [0, xMax],
              round: true,
              domain: [bins[0].lower, bins[bins.length - 1].upper],
            })
          : scaleLinear({
              range: [0, xMax],
              round: true,
              domain: [bins[0].lower, bins[bins.length - 1].upper],
            }),
    [bins, xMax, toTemporal],
  );

  const yScale = useMemo(
    () =>
      bins.length === 0
        ? null
        : scaleLinear<number>({
            range: [yMax, 0],
            round: true,
            domain: [0, Math.max(...bins.map((bin) => bin.count))],
          }),
    [bins, yMax],
  );

  if (bins.length === 0 || !xScale || !yScale) return null;

  const dataLength = bins.reduce((sum, bin) => sum + bin.count, 0);

  const barWidth = xMax / bins.length;

  return width < 10 ? null : (
    <div style={{ position: "relative" }} onClick={onClick}>
      <svg ref={containerRef} width={width} height={height}>
        <GradientTealBlue id="teal" />
        <rect width={width} height={height} fill="url(#teal)" rx={14} />
        <Group top={margin.top} left={margin.left}>
          {bins.map((bin, i) => {
            if (bin.count == 0) return;

            const lower = toTemporal ? new Date(bin.lower) : bin.lower;

            const barX = bins.length == 1 ? 0 : xScale(lower);
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
        tooltipLeft={tooltipLeft}
        tooltipTop={tooltipTop}
        renderTooltipContent={(bin) => {
          if (bin === undefined) return <></>;
          return (
            <div style={{ textAlign: "left" }}>
              <div>{`Range: ${formatter(bin.lower)} ~ ${formatter(bin.upper)}`}</div>
              <div>{`Count: ${bin.count}`}</div>
              <div>{`Props: ${((bin.count / dataLength) * 100).toFixed(1)}%`}</div>
            </div>
          );
        }}
      />
    </div>
  );
}

const sturgesFormula = (n: number) => Math.ceil(Math.log2(n) + 1);

function binData(data: number[], binCount: number | null = null): NumericBin[] {
  if (data.length === 0) return [];

  const n = data.length;

  binCount = binCount ?? sturgesFormula(n);

  const min = Math.min(...data);
  const max = Math.max(...data);
  const binWidth = (max - min) / binCount;

  const bins: NumericBin[] = [];

  // ビンの初期化
  for (let i = 0; i < binCount; i++) {
    const lower = min + i * binWidth;
    const upper = i === binCount - 1 ? max : lower + binWidth;
    bins.push({
      lower,
      upper,
      count: 0,
    });
  }

  // データをビンに振り分け
  for (const value of data) {
    for (let i = 0; i < bins.length; i++) {
      const lower = bins[i].lower;
      const upper = bins[i].upper;
      const isLastBin = i === bins.length - 1;
      if ((value >= lower && value < upper) || (isLastBin && value === upper)) {
        bins[i].count++;
        break;
      }
    }
  }

  return bins;
}
