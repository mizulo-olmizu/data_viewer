import React, { useState } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import { Schema, TableSummary, ValueCount } from "./types";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { SxProps } from "@mui/material";
import {
  HistogramChart,
  HistogramChartInteractive,
} from "./charts/HistogramChart";
import {
  ValueCountsChart,
  ValueCountsChartInteractive,
} from "./charts/ValueCountsChart.tsx";
import { formatNumber } from "./utils";
import Modal from "@mui/material/Modal";
import { format, toZonedTime } from "date-fns-tz";
import { intervalToDuration, formatDuration } from "date-fns";
import TypeIcon from "./TypeIcon";
import TypographyTruncate from "./TypographyTruncate.tsx";
import EmptyData from "./EmptyData.tsx";

export interface SummaryDisplayProps {
  schema: Schema;
  summary: TableSummary;
}

const modalStyle = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "75%",
  height: "75%",
  bgcolor: "background.paper",
  boxShadow: 24,
  pt: 1,
  pb: 4,
  px: 4,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  alignItems: "center",
};

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

const cardHeight = "750px";
const cardWidth = "350px";

export default function SummaryDisplay({
  schema,
  summary,
}: SummaryDisplayProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState<ModalData | null>(null);
  const handleClose = () => setModalOpen(false);

  if (summary.length === 0) {
    return <EmptyData />;
  }

  return (
    <>
      <Grid container spacing={3} justifyContent="center">
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
                value: null,
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
              <Grid key={index}>
                <Card sx={{ width: cardWidth, height: cardHeight }}>
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
              </Grid>
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
              <Grid key={index}>
                <Card sx={{ width: cardWidth, height: cardHeight }}>
                  <CardContent>
                    <IconTitle
                      title={columnInfo.columnName}
                      icon={
                        <TypeIcon dtypeGroup={columnInfo.columnDtypeGroup} />
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
              </Grid>
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
              <Grid key={index}>
                <Card sx={{ width: cardWidth, height: cardHeight }}>
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
              </Grid>
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
              <Grid key={index}>
                <Card sx={{ width: cardWidth, height: cardHeight }}>
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
              </Grid>
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
              <Grid key={index}>
                <Card sx={{ width: cardWidth, height: cardHeight }}>
                  <CardContent>
                    <IconTitle
                      title={columnInfo.columnName}
                      icon={
                        <TypeIcon dtypeGroup={columnInfo.columnDtypeGroup} />
                      }
                    />
                    <SummaryCardContents items={items} na="N/A" />
                  </CardContent>
                </Card>
              </Grid>
            );
          }

          return null;
        })}
      </Grid>
      <Modal
        open={modalOpen && modalData !== null}
        onClose={handleClose}
        aria-labelledby="modal-modal-title"
        aria-describedby="modal-modal-description"
      >
        <Box sx={modalStyle}>
          <IconTitle
            title={modalData?.title ?? ""}
            icon={<TypeIcon dtypeGroup={modalData?.iconType ?? "other"} />}
          />
          <Box sx={{ flexGrow: 1, width: "100%", overflow: "hidden" }}>
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
          </Box>
        </Box>
      </Modal>
    </>
  );
}

interface SummaryCardTitleProps {
  title: string;
  icon?: React.JSX.Element;
}

function IconTitle({ title, icon }: SummaryCardTitleProps) {
  return (
    <Stack
      alignItems="center"
      direction="row"
      justifyContent="center"
      gap={1}
      pt={1}
      pb={1}
    >
      {icon}
      <TypographyTruncate fontWeight="bold" fontSize="large">
        {title}
      </TypographyTruncate>
    </Stack>
  );
}

interface SummaryCardContentsItem {
  name: string;
  value: any;
  formatter?: (value: any) => any;
  nest?: SummaryCardContentsItem[] | null;
}

interface SummaryCardContentsProps {
  items: SummaryCardContentsItem[];
  precision?: number;
  na?: string;
  sx?: SxProps;
}

function SummaryCardContents({
  items,
  precision,
  na,
  sx,
}: SummaryCardContentsProps) {
  return (
    <List sx={sx}>
      {items.map((item, index) => {
        let value = item.value;
        if (value === null || value === undefined) {
          value = na;
        } else {
          if (item.formatter != undefined) {
            value = item.formatter(value);
          }
        }

        return (
          <React.Fragment key={index}>
            <ListItem key={index} sx={{ pt: 0.5, pb: 0.5 }}>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <TypographyTruncate sx={{ textAlign: "left", flexGrow: 1 }}>
                  {item.name}
                </TypographyTruncate>
                <Typography
                  sx={{ textAlign: "right", textWrap: "nowrap", pl: 1 }}
                >
                  {value}
                </Typography>
              </Box>
            </ListItem>
            {item.nest && (
              <SummaryCardContents
                items={item.nest}
                precision={precision}
                na={na}
                sx={{ pl: 2, pt: 0 }}
              />
            )}
            {index < items.length - 1 && <Divider variant="middle" />}
          </React.Fragment>
        );
      })}
    </List>
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
