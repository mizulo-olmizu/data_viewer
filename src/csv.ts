function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const str = String(value);

  if (/["\n\r,]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");
}

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
