import { format } from "sql-formatter";
import { DataFrame, DtypeGroup } from "./types";
import ScheduleIcon from "@mui/icons-material/Schedule";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import FontDownloadIcon from "@mui/icons-material/FontDownload";
import HelpCenterIcon from "@mui/icons-material/HelpCenter";
import PinIcon from "@mui/icons-material/Pin";
import FlakyIcon from "@mui/icons-material/Flaky";
import DataObjectIcon from "@mui/icons-material/DataObject";

const RESERVED_WORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "INSERT",
  "UPDATE",
  "DELETE",
  "JOIN",
  "ON",
  "GROUP",
  "BY",
  "ORDER",
  "HAVING",
  "LIMIT",
]);

export function generateDefaultQuery(data: DataFrame): string {
  if (data.length === 0) {
    return "";
  }

  const columns = Object.keys(data[0]).map((column) => {
    const needsQuotes =
      column.includes(" ") || // 空白が含まれる場合
      RESERVED_WORDS.has(column.toUpperCase()) || // 列名が予約語の場合
      /[^a-zA-Z0-9_]/.test(column) || // 特殊文字が含まれる場合
      /^\d/.test(column); // 数字で始まる場合

    return needsQuotes ? `"${column}"` : column;
  });

  const selectClause = columns.join(", ");
  return format(`SELECT ${selectClause} FROM self;`);
}

export function formatNumber(value: number, precision: number | null): string {
  if (precision === null) {
    return value.toString();
  }
  let valueString = value.toPrecision(precision);

  valueString = valueString.replace(/\.?0+$/, "");

  return valueString;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + "...";
  }
  return text;
}

export function selectIcon(iconType: DtypeGroup) {
  switch (iconType) {
    case "numeric":
      return <PinIcon />;
    case "date":
      return <CalendarMonthIcon />;
    case "datetime":
      return <CalendarMonthIcon />;
    case "time":
      return <ScheduleIcon />;
    case "string":
      return <FontDownloadIcon />;
    case "boolean":
      return <FlakyIcon />;
    case "nested":
      return <DataObjectIcon />;
    case "other":
      return <HelpCenterIcon />;
  }
}
