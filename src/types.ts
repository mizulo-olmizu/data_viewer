export type Row = Record<string, any>;

export type DataFrame = Row[];

export type DtypeGroup =
  | "numeric"
  | "temporal"
  | "duration"
  | "string"
  | "boolean"
  | "nested"
  | "other";

export interface ColumnInfo {
  columnName: string;
  columnType: string;
  columnDtypeGroup: DtypeGroup;
}

export type Schema = ColumnInfo[];

export interface ExtractDataResult {
  name: string;
  dfJson: string;
  schema: Schema;
  summary: TableSummary;
}

export interface ExtractDataResultConverted {
  name: string;
  df: DataFrame;
  schema: Schema;
  summary: TableSummary;
}

export interface Status {
  dbPath: string | null;
  port: number | null;
  lastBackendError: string | null;
}

export interface NumericStatistics {
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
  mean: number | null;
  std: number | null;
}

export interface NumericBin {
  lower: number;
  upper: number;
  count: number;
}

export type ColumnSummary =
  | {
      type: "numeric";
      columnName: string;
      summary: NumericSummary;
    }
  | {
      type: "temporal";
      columnName: string;
      summary: TemporalSummary;
    }
  | {
      type: "string";
      columnName: string;
      summary: StringSummary;
    }
  | {
      type: "boolean";
      columnName: string;
      summary: BooleanSummary;
    }
  | {
      type: "other";
      columnName: string;
      summary: OtherSummary;
    };

export interface NumericSummary {
  notNullCount: number | null;
  nullCount: number | null;
  statistics: NumericStatistics;
  bins: NumericBin[] | null;
  raw: number[];
}

export interface TemporalSummary {
  notNullCount: number | null;
  nullCount: number | null;
  numericStatistics: NumericStatistics;
  numericBins: NumericBin[] | null;
  numericRaw: number[];
}

export interface ValueCount<T> {
  value: T | null;
  count: number | null;
  prop: number | null;
}

export interface StringSummary {
  notNullCount: number | null;
  nullCount: number | null;
  uniqueCount: number | null;
  minLen: number | null;
  maxLen: number | null;
  valueCounts: ValueCount<string>[] | null;
}

export interface BooleanSummary {
  notNullCount: number | null;
  nullCount: number | null;
  valueCounts: ValueCount<boolean>[] | null;
}

export interface OtherSummary {
  notNullCount: number | null;
  nullCount: number | null;
}

export type TableSummary = ColumnSummary[];

export type ReadDataType =
  | "csv"
  | "parquet"
  | "json"
  | "text"
  | "blob"
  | "xlsx";

export type Margin = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
