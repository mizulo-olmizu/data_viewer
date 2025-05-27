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
          const valueOptions: FormatNumberOptions = {
            maxLength: 12,
            exponentialDigits: 5,
            fixedPointDigits: 2,
          };

          const countOptions: FormatNumberOptions = {
            maxLength: 12,
            exponentialDigits: 5,
          };

          const items = [
            {
              name: "Not Null Count",
              value: item.notNullCount,
              formatNumberOptions: countOptions,
            },
            {
              name: "Null Count",
              value: item.nullCount,
              formatNumberOptions: countOptions,
            },
            {
              name: "Min",
              value: item.min,
              formatNumberOptions: valueOptions,
            },
            {
              name: "Q1",
              value: item.q1,
              formatNumberOptions: valueOptions,
            },
            {
              name: "Median",
              value: item.median,
              formatNumberOptions: valueOptions,
            },
            {
              name: "Mean",
              value: item.mean,
              formatNumberOptions: valueOptions,
            },
            {
              name: "Q3",
              value: item.q3,
              formatNumberOptions: valueOptions,
            },
            {
              name: "Max",
              value: item.max,
              formatNumberOptions: valueOptions,
            },
            {
              name: "Std",
              value: item.std,
              formatNumberOptions: valueOptions,
            },
          ];

          return (
            <Grid key={index}>
              <Card sx={{ width: "350px" }}>
                <CardContent>
                  <SummaryCardContents
                    title={item.columnName}
                    icon={<PinIcon />}
                    items={items}
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
  formatNumberOptions?: FormatNumberOptions;
}

interface SummaryCardContentsProps {
  title: string;
  icon?: React.JSX.Element;
  items: SummaryCardContentsItem[];
  na?: string;
}

function SummaryCardContents({
  title,
  icon,
  items,
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
            value = formatNumber(value, item.formatNumberOptions ?? null);
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

interface FormatNumberOptions {
  maxLength?: number;
  exponentialDigits?: number;
  fixedPointDigits?: number;
  trimTrailingZeros?: boolean;
}

function formatNumber(
  value: number,
  options: FormatNumberOptions | null,
): string {
  if (options === null) {
    return value.toString();
  }

  // 絶対値を取得して処理を統一
  const absValue = Math.abs(value);

  // 条件1: 非常に大きな値や非常に小さな値は指数表記にする
  if (
    options.exponentialDigits !== undefined &&
    ((options.maxLength !== undefined &&
      absValue >= 10 ** (options.maxLength - 1)) ||
      (absValue !== 0 &&
        options.fixedPointDigits !== undefined &&
        absValue < 10 ** -(options.fixedPointDigits + 1)))
  ) {
    return value.toExponential(options.exponentialDigits);
  }

  // 条件2: 通常の値は小数点以下を丸めて表示
  let fixedValue =
    options.fixedPointDigits === undefined
      ? value.toString()
      : value.toFixed(options.fixedPointDigits);

  // 条件3: 丸めた結果が maxLength を超える場合は指数表記にする
  if (
    options.exponentialDigits &&
    options.maxLength !== undefined &&
    fixedValue.length > options.maxLength
  ) {
    return value.toExponential(options.exponentialDigits);
  }

  // 条件4: 小数点以下の末尾の 0 を削除するオプション
  if (options.trimTrailingZeros) {
    fixedValue = parseFloat(fixedValue).toString();
  }

  return fixedValue;
}
