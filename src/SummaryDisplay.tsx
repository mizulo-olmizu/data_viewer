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
                  <SummaryCardContents
                    title={item.columnName}
                    icon={<PinIcon />}
                    items={items}
                    precision={7}
                    na="N/A"
                  />
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
                  <SummaryCardContents
                    title={item.columnName}
                    icon={<ScheduleIcon />}
                    items={items}
                    na="N/A"
                  />
                </CardContent>
              </Card>
            </Grid>
          );
        }

        if (item.type == "string") {
          const items = [
            { name: "Not Null Count", value: item.notNullCount },
            { name: "Null Count", value: item.nullCount },
            { name: "Unique Count", value: item.uniqueCount },
          ];
          return (
            <Grid key={index}>
              <Card sx={{ width: "350px" }}>
                <CardContent>
                  <SummaryCardContents
                    title={item.columnName}
                    icon={<FontDownloadIcon />}
                    items={items}
                    na="N/A"
                  />
                  <h3>Value Counts:</h3>
                  {item.valueCounts ? (
                    <ul>
                      {item.valueCounts.map((vc, vcIndex) => (
                        <li key={vcIndex}>
                          Value: {vc.value}, Count: {vc.count ?? "N/A"}, Prop:{" "}
                          {vc.prop ?? "N/A"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>N/A</p>
                  )}
                </CardContent>
              </Card>
            </Grid>
          );
        }

        if (item.type == "boolean") {
          const items = [
            { name: "Not Null Count", value: item.notNullCount },
            { name: "Null Count", value: item.nullCount },
          ];
          return (
            <Grid key={index}>
              <Card sx={{ width: "350px" }}>
                <CardContent>
                  <SummaryCardContents
                    title={item.columnName}
                    icon={<FlakyIcon />}
                    items={items}
                    na="N/A"
                  />
                  <h3>Value Counts:</h3>
                  {item.valueCounts ? (
                    <ul>
                      {item.valueCounts.map((vc, vcIndex) => (
                        <li key={vcIndex}>
                          Value: {vc.value}, Count: {vc.count ?? "N/A"}, Prop:{" "}
                          {vc.prop ?? "N/A"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>N/A</p>
                  )}
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
                  <SummaryCardContents
                    title={item.columnName}
                    icon={<HelpCenterIcon />}
                    items={items}
                    na="N/A"
                  />
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

interface SummaryCardContentsItem {
  name: string;
  value: any;
}

interface SummaryCardContentsProps {
  title: string;
  icon?: React.JSX.Element;
  items: SummaryCardContentsItem[];
  precision?: number;
  na?: string;
}

function SummaryCardContents({
  title,
  icon,
  items,
  precision,
  na,
}: SummaryCardContentsProps) {
  return (
    <>
      <Stack
        alignItems="center"
        direction="row"
        justifyContent="center"
        gap={1}
      >
        {icon}
        <h2>{title}</h2>
      </Stack>
      <List>
        {items.map((item, index) => {
          let value = item.value ?? na;
          if (typeof value === "number") {
            value = formatNumber(value, precision ?? null);
          }
          return (
            <React.Fragment key={index}>
              <ListItem key={index}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    width: "100%",
                  }}
                >
                  <Typography sx={{ textAlign: "left" }}>
                    {item.name}
                  </Typography>
                  <Typography sx={{ textAlign: "right" }}>{value}</Typography>
                </Box>
              </ListItem>
              {index < items.length - 1 && <Divider />}
            </React.Fragment>
          );
        })}
      </List>
    </>
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
