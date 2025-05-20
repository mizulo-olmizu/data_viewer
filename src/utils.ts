import { format } from "sql-formatter";
import { DataFrame } from "./types";

export function generateDefaultQuery(data: DataFrame): string {
  if (data.length === 0) {
    return "";
  }

  const columns = Object.keys(data[0]);
  const selectClause = columns.join(",");
  return format(`SELECT ${selectClause} FROM self;`);
}
