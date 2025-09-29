import { format } from "sql-formatter";
import { DataFrame } from "./types";

const checkNeedsQuotes = (value: string, reservedWords: string[]) => {
  const isNeedsQuotes =
    value.includes(" ") || // 空白が含まれる場合
    reservedWords.map((s) => s.toUpperCase()).includes(value.toUpperCase()) || // 列名が予約語の場合
    /[^a-zA-Z0-9_]/.test(value) || // 特殊文字が含まれる場合
    /^\d/.test(value); // 数字で始まる場合

  return isNeedsQuotes ? `"${value}"` : value;
};

export function generateDefaultQuery(
  data: DataFrame,
  tableName: string,
  reservedWords: string[],
): string {
  if (data.length === 0) {
    return "";
  }

  const columns = Object.keys(data[0]).map((column) =>
    checkNeedsQuotes(column, reservedWords),
  );

  const selectClause = columns.join(", ");

  const tableNameQuoted = checkNeedsQuotes(tableName, reservedWords);
  return format(`SELECT ${selectClause} FROM ${tableNameQuoted};`);
}

export function formatNumber(value: number, precision: number | null): string {
  if (precision === null) {
    return value.toString();
  }
  let valueString = value.toPrecision(precision);

  valueString = valueString.replace(/\.?0+$/, "");

  return valueString;
}
