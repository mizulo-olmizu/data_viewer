import { sqlFix } from "./handler";
import { DataFrame } from "./types";
import { InferSchemaLengthSetting } from "./hooks/use-settings";

const checkNeedsQuotes = (value: string, reservedWords: string[]) => {
  const isNeedsQuotes =
    value.includes(" ") || // 空白が含まれる場合
    reservedWords.map((s) => s.toUpperCase()).includes(value.toUpperCase()) || // 列名が予約語の場合
    /[^a-zA-Z0-9_]/.test(value) || // 特殊文字が含まれる場合
    /^\d/.test(value); // 数字で始まる場合

  return isNeedsQuotes ? `"${value}"` : value;
};

export async function generateDefaultQuery(
  data: DataFrame,
  tableName: string,
  reservedWords: string[],
) {
  if (data.length === 0) {
    return "";
  }

  const columns = Object.keys(data[0]).map((column) =>
    checkNeedsQuotes(column, reservedWords),
  );

  const selectClause = columns.join(",\n");

  const tableNameQuoted = checkNeedsQuotes(tableName, reservedWords);
  return sqlFix(`SELECT ${selectClause} FROM ${tableNameQuoted};`);
}

// アップロード/D&D経由でのregisterData呼び出しに渡すoptionsマップを、設定画面の
// infer_schema_lengthデフォルト値から組み立てる。DuckDBのread_csv等が受け取る
// `sample_size`オプションに対応する(src-tauri/src/lib.rs の InferSchemaLength と同じ意味付け)。
export function inferSchemaLengthToOptions(
  setting: InferSchemaLengthSetting,
): Map<string, string> {
  switch (setting.kind) {
    case "inf":
      return new Map([["sample_size", "-1"]]);
    case "custom":
      return new Map([["sample_size", String(setting.value)]]);
    case "default":
      return new Map();
  }
}

export function formatNumber(value: number, precision: number | null): string {
  if (precision === null) {
    return value.toString();
  }
  let valueString = value.toPrecision(precision);

  valueString = valueString.replace(/\.?0+$/, "");

  return valueString;
}
