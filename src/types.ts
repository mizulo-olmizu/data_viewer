export type Row = Record<string, any>;

export type DataFrame = Row[];

export type DtypeGroup =
  | "numeric"
  | "date"
  | "datetime"
  | "time"
  | "duration"
  | "string"
  | "boolean"
  | "nested"
  | "other";

export interface SchemaField {
  name: string;
  dtype: string;
  dtypeGroup: {
    type: DtypeGroup;
  };
}

export type Schema = SchemaField[];

export interface ExtractDataResult {
  name: string;
  port: number | null;
  dfJson: string;
  schema: Schema;
  summary: Summary;
}

export interface ExtractDataResultConverted {
  name: string;
  port: number | null;
  df: DataFrame;
  schema: Schema;
  summary: Summary;
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

export interface NumericSummary {
  type: "numeric";
  columnName: string;
  dtype: string;
  dtypeGroup: {
    type: "numeric";
  };
  notNullCount: number | null;
  nullCount: number | null;
  statistics: NumericStatistics;
  bins: NumericBin[] | null;
  raw: number[];
}

export interface TemporalSummary {
  type: "temporal";
  dtype: string;
  dtypeGroup: {
    type: "date" | "datetime" | "time" | "duration";
  };
  timezone: string;
  columnName: string;
  notNullCount: number | null;
  nullCount: number | null;
  numericStatistics: NumericStatistics;
  numericBins: NumericBin[] | null;
  numericRaw: number[];
}

export interface ValueCount {
  value: string;
  count: number | null;
  prop: number | null;
}

export interface StringSummary {
  type: "string";
  columnName: string;
  dtype: string;
  dtypeGroup: {
    type: "string";
  };
  notNullCount: number | null;
  nullCount: number | null;
  uniqueCount: number | null;
  minLen: number | null;
  maxLen: number | null;
  valueCounts: ValueCount[] | null;
}

export interface BooleanSummary {
  type: "boolean";
  columnName: string;
  dtype: string;
  dtypeGroup: {
    type: "boolean";
  };
  notNullCount: number | null;
  nullCount: number | null;
  valueCounts: ValueCount[] | null;
}

export interface OtherSummary {
  type: "other";
  columnName: string;
  dtype: string;
  dtypeGroup: {
    type: "nested" | "other";
  };
  notNullCount: number | null;
  nullCount: number | null;
}

export type SummaryItem =
  | NumericSummary
  | TemporalSummary
  | StringSummary
  | BooleanSummary
  | OtherSummary;

export type Summary = SummaryItem[];

export type Margin = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
