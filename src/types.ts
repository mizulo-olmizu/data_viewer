export type Row = Record<string, any>;

export type DataFrame = Row[];

export interface SchemaField {
  name: string;
  dtype: string;
}

export type Schema = SchemaField[];

export interface ExtractDataResult {
  filePath: string;
  dfJson: string;
  schema: Schema;
  summary: Summary;
}

export interface ExtractDataResultConverted {
  filePath: string;
  df: DataFrame;
  schema: Schema;
  summary: Summary;
}

export interface NumericSummary {
  type: "numeric";
  columnName: string;
  notNullCount: number | null;
  nullCount: number | null;
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
  mean: number | null;
  std: number | null;
}

export interface TemporalSummary {
  type: "temporal";
  columnName: string;
  notNullCount: number | null;
  nullCount: number | null;
  min: string | null;
  median: string | null;
  max: string | null;
  mean: string | null;
}

export interface ValueCount {
  value: string;
  count: number | null;
  prop: number | null;
}

export interface StringSummary {
  type: "string";
  columnName: string;
  notNullCount: number | null;
  nullCount: number | null;
  uniqueCount: number | null;
  valueCounts: ValueCount[] | null;
}

export interface BooleanSummary {
  type: "boolean";
  columnName: string;
  notNullCount: number | null;
  nullCount: number | null;
  valueCounts: ValueCount[] | null;
}

export interface OtherSummary {
  type: "other";
  columnName: string;
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
