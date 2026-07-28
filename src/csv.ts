// スプレッドシートアプリへの貼り付け用。Excel/Google Sheetsの挙動に合わせ、セル内のタブ・改行はエスケープしない
export function toTsv(rows: unknown[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) =>
          cell === null || cell === undefined ? "" : String(cell),
        )
        .join("\t"),
    )
    .join("\r\n");
}
