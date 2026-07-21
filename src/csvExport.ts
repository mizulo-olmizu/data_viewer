import { save } from "@tauri-apps/plugin-dialog";
import { saveTextFile } from "./handler";

// ユーザーがダイアログをキャンセルした場合はfalseを返す(エラーではない)
export async function downloadCsv(
  csv: string,
  defaultFileName: string,
): Promise<boolean> {
  const path = await save({
    defaultPath: defaultFileName,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });

  if (!path) {
    return false;
  }

  await saveTextFile(path, csv);
  return true;
}
