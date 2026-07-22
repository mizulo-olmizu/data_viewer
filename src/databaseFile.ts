import { open, save } from "@tauri-apps/plugin-dialog";

const DUCKDB_FILE_FILTERS = [
  { name: "DuckDB Database", extensions: ["duckdb", "db"] },
];

// ユーザーがダイアログをキャンセルした場合はnullを返す(エラーではない)
export async function pickDatabaseSaveAsPath(): Promise<string | null> {
  return await save({ filters: DUCKDB_FILE_FILTERS });
}

// ユーザーがダイアログをキャンセルした場合はnullを返す(エラーではない)
export async function pickDatabaseToOpen(): Promise<string | null> {
  const path = await open({ multiple: false, filters: DUCKDB_FILE_FILTERS });
  return typeof path === "string" ? path : null;
}
