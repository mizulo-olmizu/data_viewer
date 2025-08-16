import { invoke } from "@tauri-apps/api/core";
import {
  DataFrame,
  ExtractDataResult,
  ExtractDataResultConverted,
  AppStatus,
  ReadDataType,
} from "./types";

export async function extractTable(tableName: string) {
  const result: ExtractDataResult = await invoke("extract_table", {
    tableName,
  });

  const df: DataFrame = JSON.parse(result.dfJson);

  return {
    name: result.name,
    df,
    schema: result.schema,
    summary: result.summary,
  } as ExtractDataResultConverted;
}

export async function executeQuery(sql: string) {
  const result: ExtractDataResult | null = await invoke("execute_query", {
    sql,
  });

  if (result === null) {
    return null;
  }

  const df: DataFrame = JSON.parse(result.dfJson);
  return {
    name: result.name,
    df,
    schema: result.schema,
    summary: result.summary,
  } as ExtractDataResultConverted;
}

export async function registerData(
  filePath: string,
  tableName: string | null,
  dataType: ReadDataType | null,
  allowReplace: boolean,
  options: Map<string, string>,
) {
  const resultTableName: string = await invoke("register_data", {
    filePath,
    tableName,
    dataType,
    allowReplace,
    options,
  });

  return resultTableName;
}

export async function getTableNames() {
  const result: string[] = await invoke("get_table_names", {});
  return result;
}

export async function getStatus() {
  const result: AppStatus = await invoke("get_status");
  return result;
}
