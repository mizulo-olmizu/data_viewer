import { invoke } from "@tauri-apps/api/core";
import {
  DataFrame,
  ExtractDataResult,
  ExtractDataResultConverted,
  AppStatus,
} from "./types";

export async function extractData(query?: string) {
  const result: ExtractDataResult = await invoke("extract_data", { query });
  const df: DataFrame = JSON.parse(result.dfJson);
  return {
    name: result.name,
    df,
    schema: result.schema,
    summary: result.summary,
  } as ExtractDataResultConverted;
}

export async function registerData(filePath: string) {
  await invoke("register_data", { filePath });
}

export async function getStatus() {
  const result: AppStatus = await invoke("get_status");
  return result;
}
