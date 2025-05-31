import { format } from "sql-formatter";
import { DataFrame } from "./types";

export function generateDefaultQuery(data: DataFrame): string {
  if (data.length === 0) {
    return "";
  }

  const columns = Object.keys(data[0]);
  const selectClause = columns.join(",");
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
