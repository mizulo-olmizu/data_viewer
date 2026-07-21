import React, { useState } from "react";
import { Schema, TableSummary, ValueCount } from "./types";
import {
  HistogramChart,
  HistogramChartInteractive,
} from "./charts/HistogramChart";
import {
  ValueCountsChart,
  ValueCountsChartInteractive,
} from "./charts/ValueCountsChart.tsx";
import { formatNumber } from "./utils";
import { format, toZonedTime } from "date-fns-tz";
import { intervalToDuration, formatDuration } from "date-fns";
import TypeIcon from "./TypeIcon";
import TypographyTruncate from "./TypographyTruncate.tsx";
import EmptyData from "./EmptyData.tsx";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface SummaryDisplayProps {
  schema: Schema;
  summary: TableSummary;
}

interface HistModalData {
  index: number;
  title: string;
  iconType: "numeric" | "temporal";
  chart: "histogram";
  toTemporal?: boolean;
  formatter?: (i: number) => string;
  data: number[];
}

interface ValueCountsModalData {
  index: number;
  title: string;
  iconType: "string" | "boolean";
  chart: "valueCounts";
  data: ValueCount<string>[];
}

type ModalData = HistModalData | ValueCountsModalData;

const numericFormatter = (precision: number) => (i: number) =>
  formatNumber(i, precision);

const temporalFormatter =
  (
    dateType: "date" | "datetime" | "time" | "duration",
    timeZone: string | null,
  ) =>
  (i: number) => {
    if (dateType == "duration") {
      const duration = intervalToDuration({ start: 0, end: i });
      return formatDuration(duration);
    }

    const date = new Date(i);
    timeZone = timeZone ?? "UTC";
    const date_tz = toZonedTime(date, timeZone);

    let formatStr = "";
    switch (dateType) {
      case "date":
        formatStr = "yyyy-MM-dd";
        break;
      case "datetime":
        formatStr =
          timeZone == "UTC" ? "yyyy-MM-dd HH:mm:ss" : "yyyy-MM-dd HH:mm:ss xxx";
        break;
      case "time":
        formatStr = "HH:mm:ss";
        break;
    }

    return format(date_tz, formatStr, {
      timeZone,
    });
  };

export default function SummaryDisplay({
  schema,
  summary,
}: SummaryDisplayProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState<ModalData | null>(null);

  if (summary.length === 0) {
    return <EmptyData />;
  }

  return (
    <>
      <div className="flex flex-wrap gap-3 justify-center">
        {schema.map((columnInfo, index) => {
          const columnSummary = summary.find(
            (columnSummary) =>
              columnSummary.columnName === columnInfo.columnName,
          );

          if (!columnSummary) {
            return null;
          }

          if (columnSummary.type == "numeric") {
            const items = [
              {
                name: "Data Type",
                value: columnInfo.columnType,
              },
              {
                name: "Not Null Count",
                value: columnSummary.summary.notNullCount,
                formatter: numericFormatter(7),
              },
              {
                name: "Null Count",
                value: columnSummary.summary.nullCount,
                formatter: numericFormatter(7),
              },
              {
                name: "Min",
                value: columnSummary.summary.statistics.min,
                formatter: numericFormatter(7),
              },
              {
                name: "Q1",
                value: columnSummary.summary.statistics.q1,
                formatter: numericFormatter(7),
              },
              {
                name: "Median",
                value: columnSummary.summary.statistics.median,
                formatter: numericFormatter(7),
              },
              {
                name: "Mean",
                value: columnSummary.summary.statistics.mean,
                formatter: numericFormatter(7),
              },
              {
                name: "Q3",
                value: columnSummary.summary.statistics.q3,
                formatter: numericFormatter(7),
              },
              {
                name: "Max",
                value: columnSummary.summary.statistics.max,
                formatter: numericFormatter(7),
              },
              {
                name: "Std",
                value: columnSummary.summary.statistics.std,
                formatter: numericFormatter(7),
              },
            ];

            return (
              <div key={index}>
                <Card className="w-[350px] h-[750px]">
                  <CardContent>
                    <IconTitle
                      title={columnSummary.columnName}
                      icon={<TypeIcon dtypeGroup="numeric" />}
                    />
                    <HistogramChart
                      bins={columnSummary.summary.bins ?? []}
                      width={300}
                      height={200}
                      formatter={numericFormatter(7)}
                      onClick={() => {
                        setModalOpen(true);
                        setModalData({
                          chart: "histogram",
                          index,
                          title: columnSummary.columnName,
                          iconType: "numeric",
                          data: columnSummary.summary.raw,
                          formatter: numericFormatter(7),
                        });
                      }}
                    />
                    <SummaryCardContents items={items} precision={7} na="N/A" />
                  </CardContent>
                </Card>
              </div>
            );
          }

          if (columnSummary.type == "temporal") {
            // TODO 要修正
            const temporalType = "datetime";
            const formatter = temporalFormatter(temporalType, null);

            const items = [
              {
                name: "Data Type",
                value: columnInfo.columnType,
              },
              {
                name: "Not Null Count",
                value: columnSummary.summary.notNullCount,
                formatter: numericFormatter(7),
              },
              {
                name: "Null Count",
                value: columnSummary.summary.nullCount,
                formatter: numericFormatter(7),
              },
              {
                name: "Min",
                value: columnSummary.summary.numericStatistics.min,
                formatter,
              },
              {
                name: "Q1",
                value: columnSummary.summary.numericStatistics.q1,
                formatter,
              },
              {
                name: "Median",
                value: columnSummary.summary.numericStatistics.median,
                formatter,
              },
              {
                name: "Mean",
                value: columnSummary.summary.numericStatistics.mean,
                formatter,
              },
              {
                name: "Q3",
                value: columnSummary.summary.numericStatistics.q3,
                formatter,
              },
              {
                name: "Max",
                value: columnSummary.summary.numericStatistics.max,
                formatter,
              },
            ];

            return (
              <div key={index}>
                <Card className="w-[350px] h-[750px]">
                  <CardContent>
                    <IconTitle
                      title={columnInfo.columnName}
                      icon={
                        <TypeIcon
                          dtypeGroup={columnInfo.columnDtypeGroup.type}
                        />
                      }
                    />
                    <HistogramChart
                      bins={columnSummary.summary.numericBins ?? []}
                      width={300}
                      height={200}
                      toTemporal={true}
                      formatter={formatter}
                      onClick={() => {
                        setModalOpen(true);
                        setModalData({
                          chart: "histogram",
                          index,
                          title: columnSummary.columnName,
                          iconType: "temporal",
                          toTemporal: true,
                          formatter,
                          data: columnSummary.summary.numericRaw,
                        });
                      }}
                    />
                    <SummaryCardContents items={items} na="N/A" />
                  </CardContent>
                </Card>
              </div>
            );
          }

          if (columnSummary.type == "string") {
            const summarisedValueCounts = columnSummary.summary.valueCounts
              ? summarizeValueCounts(columnSummary.summary.valueCounts, 5)
              : [];

            const valueCountItems = summarisedValueCounts.map((vc) => ({
              name: vc.value ?? "",
              value: `${vc.count} (${vc.prop ? (vc.prop * 100).toFixed(1) : " "}%)`,
            }));

            const items: SummaryCardContentsItem[] = [
              {
                name: "Data Type",
                value: columnInfo.columnType,
              },
              {
                name: "Not Null Count",
                value: columnSummary.summary.notNullCount,
                formatter: numericFormatter(7),
              },
              {
                name: "Null Count",
                value: columnSummary.summary.nullCount,
                formatter: numericFormatter(7),
              },
              {
                name: "Unique Count",
                value: columnSummary.summary.uniqueCount,
                formatter: numericFormatter(7),
              },
              {
                name: "Min Length",
                value: columnSummary.summary.minLen,
                formatter: numericFormatter(7),
              },
              {
                name: "Max Length",
                value: columnSummary.summary.maxLen,
                formatter: numericFormatter(7),
              },
              { name: "Value Count", value: "", nest: valueCountItems },
            ];
            return (
              <div key={index}>
                <Card className="w-[350px] h-[750px]">
                  <CardContent>
                    <IconTitle
                      title={columnInfo.columnName}
                      icon={<TypeIcon dtypeGroup="string" />}
                    />
                    <ValueCountsChart
                      data={summarisedValueCounts}
                      width={300}
                      height={200}
                      onClick={() => {
                        setModalOpen(true);
                        setModalData({
                          chart: "valueCounts",
                          index,
                          title: columnInfo.columnName,
                          iconType: "string",
                          data: columnSummary.summary.valueCounts ?? [],
                        });
                      }}
                      otherIndex={5}
                    />
                    <SummaryCardContents items={items} na="N/A" />
                  </CardContent>
                </Card>
              </div>
            );
          }

          if (columnSummary.type == "boolean") {
            const valueCountItems = columnSummary.summary.valueCounts
              ? columnSummary.summary.valueCounts.map((vc) => ({
                  name: String(vc.value),
                  value: `${vc.count} (${vc.prop ? (vc.prop * 100).toFixed(1) : " "}%)`,
                }))
              : null;

            const items: SummaryCardContentsItem[] = [
              {
                name: "Data Type",
                value: columnInfo.columnType,
              },
              {
                name: "Not Null Count",
                value: columnSummary.summary.notNullCount,
                formatter: numericFormatter(7),
              },
              {
                name: "Null Count",
                value: columnSummary.summary.nullCount,
                formatter: numericFormatter(7),
              },
              { name: "Value Count", value: "", nest: valueCountItems },
            ];

            const data = columnSummary.summary.valueCounts
              ? columnSummary.summary.valueCounts
                  .map((vc) => {
                    return {
                      value: String(vc.value),
                      count: vc.count,
                      prop: vc.prop,
                    };
                  })
                  .sort((a, b) => {
                    const order = ["true", "false", "null"];
                    return order.indexOf(a.value) - order.indexOf(b.value);
                  })
              : [];

            return (
              <div key={index}>
                <Card className="w-[350px] h-[750px]">
                  <CardContent>
                    <IconTitle
                      title={columnInfo.columnName}
                      icon={<TypeIcon dtypeGroup="boolean" />}
                    />
                    <ValueCountsChart
                      data={data}
                      width={300}
                      height={200}
                      onClick={() => {
                        setModalOpen(true);
                        setModalData({
                          chart: "valueCounts",
                          index,
                          title: columnInfo.columnName,
                          iconType: "boolean",
                          data,
                        });
                      }}
                    />
                    <SummaryCardContents items={items} na="N/A" />
                  </CardContent>
                </Card>
              </div>
            );
          }

          if (columnSummary.type == "other") {
            const items = [
              {
                name: "Data Type",
                value: columnInfo.columnType,
              },
              {
                name: "Not Null Count",
                value: columnSummary.summary.notNullCount,
                formatter: numericFormatter(7),
              },
              {
                name: "Null Count",
                value: columnSummary.summary.nullCount,
                formatter: numericFormatter(7),
              },
            ];
            return (
              <div key={index}>
                <Card className="w-[350px] h-[750px]">
                  <CardContent>
                    <IconTitle
                      title={columnInfo.columnName}
                      icon={
                        <TypeIcon
                          dtypeGroup={columnInfo.columnDtypeGroup.type}
                        />
                      }
                    />
                    <SummaryCardContents items={items} na="N/A" />
                  </CardContent>
                </Card>
              </div>
            );
          }

          return null;
        })}
      </div>
      <Dialog
        open={modalOpen && modalData !== null}
        onOpenChange={setModalOpen}
      >
        <DialogContent className="h-3/4 sm:max-w-3/4">
          <DialogHeader>
            <DialogTitle>
              <IconTitle
                title={modalData?.title ?? ""}
                icon={<TypeIcon dtypeGroup={modalData?.iconType ?? "other"} />}
              />
            </DialogTitle>
          </DialogHeader>
          <div className="grow w-full overflow-hidden">
            {modalData !== null && modalData.chart == "histogram" ? (
              <HistogramChartInteractive
                data={modalData.data}
                width="100%"
                height="100%"
                detail
                toTemporal={modalData.toTemporal}
                formatter={modalData.formatter}
              />
            ) : modalData !== null && modalData.chart == "valueCounts" ? (
              <ValueCountsChartInteractive
                data={modalData.data}
                width="100%"
                height="100%"
                detail
              />
            ) : (
              <></>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface SummaryCardTitleProps {
  title: string;
  icon?: React.JSX.Element;
}

function IconTitle({ title, icon }: SummaryCardTitleProps) {
  return (
    <div className="flex flex-row justify-center items-center gap-1 pt-1 pb-1">
      {icon}
      <TypographyTruncate className="font-bold text-lg">
        {title}
      </TypographyTruncate>
    </div>
  );
}

interface SummaryCardContentsItem {
  name: string;
  value: number | string | null | undefined;
  formatter?: (value: number) => string;
  nest?: SummaryCardContentsItem[] | null;
}

interface SummaryCardContentsProps {
  items: SummaryCardContentsItem[];
  precision?: number;
  na?: string;
  className?: string;
}

function SummaryCardContents({
  items,
  precision,
  na,
  className,
}: SummaryCardContentsProps) {
  return (
    <ul className={cn("divide-y", className)}>
      {items.map((item, index) => {
        let value: React.ReactNode = item.value;
        if (item.value === null || item.value === undefined) {
          value = na;
        } else if (item.formatter != undefined) {
          value = item.formatter(item.value as number);
        }

        return (
          <React.Fragment key={index}>
            <li key={index} className="pt-0.5 pb-0.5">
              <div className="flex justify-between w-full">
                <TypographyTruncate className="text-left grow">
                  {item.name}
                </TypographyTruncate>
                <span className="text-right text-nowrap pl-1">{value}</span>
              </div>
            </li>
            {item.nest && (
              <SummaryCardContents
                items={item.nest}
                precision={precision}
                na={na}
                className="pl-2 pt-0"
              />
            )}
          </React.Fragment>
        );
      })}
    </ul>
  );
}

function summarizeValueCounts(
  data: ValueCount<string>[],
  remainLength: number,
  otherName?: string,
): ValueCount<string>[] {
  if (data.length <= remainLength) {
    return data;
  }

  otherName = otherName ?? `other(${data.length - remainLength})`;

  const remaining = data.slice(0, remainLength);
  const summarized = data.slice(remainLength);

  const other: ValueCount<string> = {
    value: otherName,
    count: summarized.reduce((sum, item) => sum + (item.count ?? 0), 0),
    prop: summarized.reduce((sum, item) => sum + (item.prop ?? 0), 0),
  };

  return [...remaining, other];
}
