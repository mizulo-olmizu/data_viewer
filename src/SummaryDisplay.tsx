import React, { useState } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import { Summary, DataFrame, ValueCount } from "./types";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import PinIcon from "@mui/icons-material/Pin";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import ScheduleIcon from "@mui/icons-material/Schedule";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import FontDownloadIcon from "@mui/icons-material/FontDownload";
import HelpCenterIcon from "@mui/icons-material/HelpCenter";
import FlakyIcon from "@mui/icons-material/Flaky";
import { SxProps } from "@mui/material";
import HistogramChart from "./charts/HistogramChart";
import ValueCountsChart from "./charts/ValueCountsChart.tsx";
import { formatNumber, truncateText } from "./utils";
import Modal from "@mui/material/Modal";
import { ParentSize } from "@visx/responsive";

export interface SummaryDisplayProps {
  summary: Summary;
  rowData: DataFrame;
}

const modalStyle = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "80%",
  height: "80%",
  bgcolor: "background.paper",
  border: "2px solid #fff",
  boxShadow: 24,
  p: 4,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
};

interface HistModalData {
  index: number;
  chart: "histogram";
  data: (number | Date)[];
}

interface ValueCountsModalData {
  index: number;
  chart: "valueCounts";
  data: ValueCount[];
}

type ModalData = HistModalData | ValueCountsModalData;

export default function SummaryDisplay({
  summary,
  rowData,
}: SummaryDisplayProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState<ModalData | null>(null);
  const handleClose = () => setModalOpen(false);

  return (
    <>
      <Grid container spacing={3}>
        {summary.map((item, index) => {
          if (item.type == "numeric") {
            const items = [
              { name: "Not Null Count", value: item.notNullCount },
              { name: "Null Count", value: item.nullCount },
              { name: "Min", value: item.min },
              { name: "Q1", value: item.q1 },
              { name: "Median", value: item.median },
              { name: "Mean", value: item.mean },
              { name: "Q3", value: item.q3 },
              { name: "Max", value: item.max },
              { name: "Std", value: item.std },
            ];

            const data = rowData
              .map((row) => row[item.columnName])
              .filter((field) => field !== null);

            return (
              <Grid key={index}>
                <Card sx={{ width: "350px", height: "680px" }}>
                  <CardContent>
                    <SummaryCardTitle
                      title={item.columnName}
                      icon={<PinIcon />}
                    />
                    <HistogramChart
                      data={data}
                      width={300}
                      height={200}
                      onClick={() => {
                        setModalOpen(true);
                        setModalData({
                          chart: "histogram",
                          index,
                          data,
                        });
                      }}
                      events={true}
                    />
                    <SummaryCardContents items={items} precision={7} na="N/A" />
                  </CardContent>
                </Card>
              </Grid>
            );
          }

          if (item.type == "temporal") {
            const items = [
              { name: "Not Null Count", value: item.notNullCount },
              { name: "Null Count", value: item.nullCount },
              { name: "Min", value: item.min },
              { name: "Median", value: item.median },
              { name: "Max", value: item.max },
              { name: "Mean", value: item.mean },
            ];

            const data = rowData.map((row) => {
              const field = row[item.columnName];

              if (typeof field != "string") {
                throw Error("type required to be string");
              }

              if (item.subType == "time") {
                return new Date(`1970-01-01T${field}`);
              } else {
                return new Date(row[item.columnName]);
              }
            });

            return (
              <Grid key={index}>
                <Card sx={{ width: "350px", height: "680px" }}>
                  <CardContent>
                    <SummaryCardTitle
                      title={item.columnName}
                      icon={
                        item.subType == "time" ? (
                          <ScheduleIcon />
                        ) : (
                          <CalendarMonthIcon />
                        )
                      }
                    />
                    <HistogramChart
                      data={data}
                      width={300}
                      height={200}
                      onClick={() => {
                        setModalOpen(true);
                        setModalData({
                          chart: "histogram",
                          index,
                          data,
                        });
                      }}
                      events={true}
                    />
                    <SummaryCardContents items={items} na="N/A" />
                  </CardContent>
                </Card>
              </Grid>
            );
          }

          if (item.type == "string") {
            const valueCounts = item.valueCounts
              ? summarizeValueCounts(item.valueCounts, 5)
              : [];

            const valueCountItems = valueCounts.map((vc) => ({
              name: truncateText(vc.value, 18),
              value: `${vc.count} (${vc.prop ? (vc.prop * 100).toFixed(1) : " "}%)`,
            }));

            const items = [
              { name: "Not Null Count", value: item.notNullCount },
              { name: "Null Count", value: item.nullCount },
              { name: "Unique Count", value: item.uniqueCount },
              { name: "Value Count", value: "", nest: valueCountItems },
            ];
            return (
              <Grid key={index}>
                <Card sx={{ width: "350px", height: "680px" }}>
                  <CardContent>
                    <SummaryCardTitle
                      title={item.columnName}
                      icon={<FontDownloadIcon />}
                    />
                    <ValueCountsChart
                      data={valueCounts}
                      width={300}
                      height={200}
                      onClick={() => {
                        setModalOpen(true);
                        setModalData({
                          chart: "valueCounts",
                          index,
                          data: valueCounts,
                        });
                      }}
                      otherIndex={5}
                      events={true}
                    />
                    <SummaryCardContents items={items} na="N/A" />
                  </CardContent>
                </Card>
              </Grid>
            );
          }

          if (item.type == "boolean") {
            const valueCountItems = item.valueCounts
              ? item.valueCounts.map((vc) => ({
                  name: vc.value,
                  value: `${vc.count} (${vc.prop ? (vc.prop * 100).toFixed(1) : " "}%)`,
                }))
              : null;

            const items = [
              { name: "Not Null Count", value: item.notNullCount },
              { name: "Null Count", value: item.nullCount },
              { name: "Value Count", value: "", nest: valueCountItems },
            ];

            const data = item.valueCounts
              ? item.valueCounts.sort((a, b) => {
                  const order = ["true", "false", "null"];
                  return order.indexOf(a.value) - order.indexOf(b.value);
                })
              : [];

            return (
              <Grid key={index}>
                <Card sx={{ width: "350px", height: "680px" }}>
                  <CardContent>
                    <SummaryCardTitle
                      title={item.columnName}
                      icon={<FlakyIcon />}
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
                          data,
                        });
                      }}
                      events={true}
                    />
                    <SummaryCardContents items={items} na="N/A" />
                  </CardContent>
                </Card>
              </Grid>
            );
          }

          if (item.type == "other") {
            const items = [
              { name: "Not Null Count", value: item.notNullCount },
              { name: "Null Count", value: item.nullCount },
            ];
            return (
              <Grid key={index}>
                <Card sx={{ width: "350px", height: "680px" }}>
                  <CardContent>
                    <SummaryCardTitle
                      title={item.columnName}
                      icon={<HelpCenterIcon />}
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
          <ParentSize>
            {(parent) => {
              if (modalData !== null && modalData.chart == "histogram") {
                return (
                  <HistogramChart
                    data={modalData.data}
                    width={parent.width}
                    height={parent.height}
                  />
                );
              }
              if (modalData !== null && modalData.chart == "valueCounts") {
                return (
                  <ValueCountsChart
                    data={modalData.data}
                    width={parent.width}
                    height={parent.height}
                  />
                );
              }
              {
                return <></>;
              }
            }}
          </ParentSize>
        </Box>
      </Modal>
    </>
  );
}

interface SummaryCardTitleProps {
  title: string;
  icon?: React.JSX.Element;
}

function SummaryCardTitle({ title, icon }: SummaryCardTitleProps) {
  return (
    <Stack alignItems="center" direction="row" justifyContent="center" gap={1}>
      {icon}
      <h2>{title}</h2>
    </Stack>
  );
}

interface SummaryCardContentsItem {
  name: string;
  value: any;
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
        let value = item.value ?? na;
        if (typeof value === "number") {
          value = formatNumber(value, precision ?? null);
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
                <Typography sx={{ textAlign: "left" }}>{item.name}</Typography>
                <Typography sx={{ textAlign: "right" }}>{value}</Typography>
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
  data: ValueCount[],
  remainLength: number,
  otherName?: string,
): ValueCount[] {
  if (data.length <= remainLength) {
    return data;
  }

  otherName = otherName ?? `other(${data.length - remainLength})`;

  const remaining = data.slice(0, remainLength);
  const summarized = data.slice(remainLength);

  const other: ValueCount = {
    value: otherName,
    count: summarized.reduce((sum, item) => sum + (item.count ?? 0), 0),
    prop: summarized.reduce((sum, item) => sum + (item.prop ?? 0), 0),
  };

  return [...remaining, other];
}
