import { invoke } from "@tauri-apps/api/core";
import {
  DataFrame,
  ExtractDataResult,
  ExtractDataResultConverted,
  Status,
  ReadDataType,
  Diagnostic,
  DuckdbSymbol,
  LogEntry,
} from "./types";
import { Settings } from "./hooks/use-settings";

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

export async function sqlLint(sql: string) {
  const result: Diagnostic[] = await invoke("sql_lint", { sql });
  return result;
}

export async function sqlFix(sql: string) {
  const result: string = await invoke("sql_fix", { sql });
  return result;
}

export async function getDuckdbSymbols() {
  const result: DuckdbSymbol[] = await invoke("get_duckdb_symbols");
  return result;
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
  const result: Status = await invoke("get_status");
  return result;
}

export async function dismissBackendError() {
  await invoke("dismiss_backend_error");
}

export async function getLogs() {
  const result: LogEntry[] = await invoke("get_logs");
  return result;
}

export async function saveTextFile(path: string, content: string) {
  await invoke("save_text_file", { path, content });
}

export async function saveDatabase(path: string) {
  await invoke("save_database", { path });
}

export async function openDatabase(path: string) {
  await invoke("open_database", { path });
}

export async function newInMemoryDatabase() {
  await invoke("new_in_memory_database");
}

export async function getSettings() {
  const result: Partial<Settings> = await invoke("get_settings");
  return result;
}

export async function setSettings(settings: Settings) {
  await invoke("set_settings", { settings });
}

export async function switchHttpPort(port: number) {
  await invoke("switch_http_port", { port });
}

export async function dropTable(tableName: string) {
  await invoke("drop_table", { tableName });
}

export async function renameTable(oldName: string, newName: string) {
  await invoke("rename_table", { oldName, newName });
}
