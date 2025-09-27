import { format } from "sql-formatter";
import { DataFrame } from "./types";
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

const checkNeedsQuotes = (value: string) => {
  const isNeedsQuotes =
    value.includes(" ") || // 空白が含まれる場合
    RESERVED_WORDS.has(value.toUpperCase()) || // 列名が予約語の場合
    /[^a-zA-Z0-9_]/.test(value) || // 特殊文字が含まれる場合
    /^\d/.test(value); // 数字で始まる場合

  return isNeedsQuotes ? `"${value}"` : value;
};

export function generateDefaultQuery(
  data: DataFrame,
  table_name: string,
): string {
  if (data.length === 0) {
    return "";
  }

  const columns = Object.keys(data[0]).map((column) =>
    checkNeedsQuotes(column),
  );

  const selectClause = columns.join(", ");

  const table_name_quoted = checkNeedsQuotes(table_name);
  return format(`SELECT ${selectClause} FROM ${table_name_quoted};`);
}

export function formatNumber(value: number, precision: number | null): string {
  if (precision === null) {
    return value.toString();
  }
  let valueString = value.toPrecision(precision);

  valueString = valueString.replace(/\.?0+$/, "");

  return valueString;
}
