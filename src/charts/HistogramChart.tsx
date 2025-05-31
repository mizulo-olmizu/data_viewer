import { useMemo } from "react";
import { Bar } from "@visx/shape";
import { Group } from "@visx/group";
import { GradientTealBlue } from "@visx/gradient";
import { scaleLinear, scaleUtc, coerceNumber } from "@visx/scale";

export type HistgramChartProps = {
  data: (number | Date)[];
  width: number;
  height: number;
  events?: boolean;
  verticalMargin?: number;
  horizontalMargin?: number;
};

const getMinMax = (vals: (number | { valueOf(): number })[]) => {
  const numericVals = vals.map(coerceNumber);
  return [Math.min(...numericVals), Math.max(...numericVals)];
};

export default function HistogramChart({
  data,
  width,
  height,
  events = false,
  verticalMargin = 60,
  horizontalMargin = 30,
}: HistgramChartProps) {
  if (data.length === 0) return null;

  const xMax = width - horizontalMargin;
  const yMax = height - verticalMargin;

  const bins = binData(data);

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
  }, [data, xMax]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        range: [yMax, 0],
        round: true,
        domain: [0, Math.max(...bins.map((bin) => bin.count))],
      }),
    [data, yMax],
  );

  const barWidth = xMax / bins.length;

  return width < 10 ? null : (
    <svg width={width} height={height}>
      <GradientTealBlue id="teal" />
      <rect width={width} height={height} fill="url(#teal)" rx={14} />
      <Group top={verticalMargin / 2} left={horizontalMargin / 2}>
        {bins.map((bin, i) => {
          const barX = bins.length == 1 ? 0 : xScale(bin.range[0]);
          const barHeight = yMax - yScale(bin.count);
          const barY = yMax - barHeight;

          return (
            <Bar
              key={`bar-${i}`}
              x={barX}
              y={barY}
              width={barWidth}
              height={barHeight}
              fill="rgba(23, 233, 217, .5)"
              onClick={() => {
                if (events)
                  alert(
                    `clicked: ${bin.range[0]} ~ ${bin.range[1]} -> count: ${bin.count}`,
                  );
              }}
            />
          );
        })}
      </Group>
    </svg>
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
