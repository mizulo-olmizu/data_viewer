import { useMemo, useState } from "react";
import { Bar } from "@visx/shape";
import { Group } from "@visx/group";
import { GradientTealBlue } from "@visx/gradient";
import { scaleLinear, scaleUtc } from "@visx/scale";
import { useChartTooltip } from "./useChartTooltip";
import { ChartTooltip } from "./ChartTooltip";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Slider } from "@/components/ui/slider";
import { ParentSize } from "@visx/responsive";
import { Margin, NumericBin } from "../types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNumericBins } from "../useNumericBins";

export type HistogramChartInteractiveProps = {
  tableName: string;
  columnName: string;
  initialBins: NumericBin[];
  initialMin: number;
  initialMax: number;
  width?: number | string;
  height: number | string;
  onClick?: () => void;
  detail?: boolean;
  margin?: Margin;
  toTemporal?: boolean;
  formatter?: (i: number) => string;
};

// ビン数変更・範囲フィルタは生データをクライアントに持たず、パラメータ変更のたびに
// useNumericBins経由でバックエンド(DuckDB)へ再クエリする(docs/design/performance.md参照)。
export function HistogramChartInteractive({
  tableName,
  columnName,
  initialBins,
  initialMin,
  initialMax,
  onClick,
  detail = false,
  margin = { top: 50, right: 50, bottom: 50, left: 80 },
  toTemporal = false,
  formatter = (i: number) => String(i),
}: HistogramChartInteractiveProps) {
  // 表示中の列が切り替わった(モーダルが同一インスタンスのまま別列を指すようになった)場合に
  // ローカルstateをリセットするための識別キー(既存のusePagedRowsのqueryKeyと同じ考え方)。
  const identityKey = `${tableName}|${columnName}`;
  const [prevIdentityKey, setPrevIdentityKey] = useState(identityKey);
  const [binCount, setBinCount] = useState(initialBins.length || 1);
  const [range, setRange] = useState<[number, number]>([
    initialMin,
    initialMax,
  ]);

  if (identityKey !== prevIdentityKey) {
    setPrevIdentityKey(identityKey);
    setBinCount(initialBins.length || 1);
    setRange([initialMin, initialMax]);
  }

  const bins = useNumericBins(initialBins, {
    tableName,
    columnName,
    isTemporal: toTemporal,
    binCount,
    rangeMin: range[0],
    rangeMax: range[1],
  });

  if (initialBins.length === 0) return null;

  const sliderDivisions = 50;
  // 定数列(全部同じ値)だとinitialMax === initialMinとなりstepが0になってしまうため、
  // その場合は1にフォールバックする。
  const sliderStep =
    initialMax > initialMin ? (initialMax - initialMin) / sliderDivisions : 1;

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
            value={range}
            onValueChange={(value) => {
              setRange([value[0], value[1]]);
            }}
            min={initialMin}
            max={initialMax}
            step={sliderStep}
          />
          <div className="flex items-center">
            <Label className="mr-2">Bin count</Label>
            <Input
              className="w-30"
              type="number"
              value={binCount}
              onChange={(e) => {
                const parsed = Math.floor(Number(e.target.value));
                setBinCount(
                  Number.isFinite(parsed) && parsed >= 1 ? parsed : 1,
                );
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
