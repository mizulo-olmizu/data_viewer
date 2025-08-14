import { invoke } from "@tauri-apps/api/core";
import {
  DataFrame,
  ExtractDataResult,
  ExtractDataResultConverted,
  AppStatus,
} from "./types";

export async function extractTable() {
  const result: ExtractDataResult = await invoke("extract_table", {
    tableName: "_default",
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

export async function registerData(filePath: string) {
  await invoke("register_data", {
    filePath,
    tableName: "_default",
    dataType: "Csv",
    allowReplace: true,
    options: {},
  });
}

export async function getTableNames() {
  const result: string[] = await invoke("get_table_names", {});
  return result;
}

export async function getStatus() {
  const result: AppStatus = await invoke("get_status");
  console.log(result);
  return result;
}
