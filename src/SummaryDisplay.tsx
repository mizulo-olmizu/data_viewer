import React from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import { Summary } from "./types";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import PinIcon from "@mui/icons-material/Pin";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import ScheduleIcon from "@mui/icons-material/Schedule";
import FontDownloadIcon from "@mui/icons-material/FontDownload";
import HelpCenterIcon from "@mui/icons-material/HelpCenter";
import FlakyIcon from "@mui/icons-material/Flaky";
import { SxProps } from "@mui/material";

export interface SummaryDisplayProps {
  summary: Summary;
}

export default function SummaryDisplay({ summary }: SummaryDisplayProps) {
  return (
    <Grid container spacing={2}>
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

          return (
            <Grid key={index}>
              <Card sx={{ width: "350px" }}>
                <CardContent>
                  <SummaryCardTitle
                    title={item.columnName}
                    icon={<PinIcon />}
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
          return (
            <Grid key={index}>
              <Card sx={{ width: "350px" }}>
                <CardContent>
                  <SummaryCardTitle
                    title={item.columnName}
                    icon={<ScheduleIcon />}
                  />
                  <SummaryCardContents items={items} na="N/A" />
                </CardContent>
              </Card>
            </Grid>
          );
        }

        if (item.type == "string") {
          const valueCountItems = item.valueCounts
            ? item.valueCounts.map((vc) => ({
                name: vc.value,
                value: `${vc.count} (${vc.prop ? (vc.prop * 100).toFixed(1) : " "}%)`,
              }))
            : null;
          const items = [
            { name: "Not Null Count", value: item.notNullCount },
            { name: "Null Count", value: item.nullCount },
            { name: "Unique Count", value: item.uniqueCount },
            { name: "Value Count", value: "", nest: valueCountItems },
          ];
          return (
            <Grid key={index}>
              <Card sx={{ width: "350px" }}>
                <CardContent>
                  <SummaryCardTitle
                    title={item.columnName}
                    icon={<FontDownloadIcon />}
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
          return (
            <Grid key={index}>
              <Card sx={{ width: "350px" }}>
                <CardContent>
                  <SummaryCardTitle
                    title={item.columnName}
                    icon={<FlakyIcon />}
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
              <Card sx={{ width: "350px" }}>
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

function formatNumber(value: number, precision: number | null): string {
  if (precision === null) {
    return value.toString();
  }
  let valueString = value.toPrecision(precision);

  valueString = valueString.replace(/\.?0+$/, "");

  return valueString;
}
