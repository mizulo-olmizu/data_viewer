import { save } from "@tauri-apps/plugin-dialog";

// 保存先パスをネイティブダイアログで選ばせる。キャンセルされた場合はnullを返す
// (エラーではない)。CSV本文の生成自体はDuckDB側の`COPY TO`が直接行うため、
// ここではパス選択のみを担当する。
export async function pickCsvSavePath(
  defaultFileName: string,
): Promise<string | null> {
  const path = await save({
    defaultPath: defaultFileName,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });

  return path ?? null;
}
