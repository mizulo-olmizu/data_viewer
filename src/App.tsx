import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import {
  MaterialReactTable,
  useMaterialReactTable,
  type MRT_ColumnDef,
} from "material-react-table";
import { useMemo } from "react";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import { format } from "sql-formatter";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";

import FileInput from "./FileInput";

type Row = Record<string, any>;
type DataFrame = Row[];

interface SchemaField {
  name: string;
  dtype: string;
}
type Schema = SchemaField[];

interface ExtractDataResult {
  filePath: string;
  dfJson: string;
  schema: Schema;
  summary: Summary[];
}

interface ExtractDataResultConverted {
  filePath: string;
  df: DataFrame;
  schema: Schema;
  summary: Summary[];
}

interface NumericSummary {
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
}

interface ValueCount {
  value: string;
  count: number | null;
  prop: number | null;
}

interface CategoricalSummary {
  type: "categorical";
  columnName: string;
  notNullCount: number | null;
  nullCount: number | null;
  valueCounts: ValueCount[] | null;
}

interface OtherSummary {
  type: "other";
  columnName: string;
  notNullCount: number | null;
  nullCount: number | null;
}

type Summary = NumericSummary | CategoricalSummary | OtherSummary;

async function extractData(query?: string) {
  const result: ExtractDataResult = await invoke("extract_data", { query });
  const df: DataFrame = JSON.parse(result.dfJson);
  return {
    filePath: result.filePath,
    df,
    schema: result.schema,
    summary: result.summary,
  } as ExtractDataResultConverted;
}

function generateDefaultQuery(data: Row[]): string {
  if (data.length === 0) {
    return "";
  }

  const columns = Object.keys(data[0]);
  const selectClause = columns.join(",");
  return format(`SELECT ${selectClause} FROM self;`);
}

interface TableProps {
  data: Row[];
}

function Table({ data }: TableProps) {
  const columns = useMemo<MRT_ColumnDef<Record<string, any>>[]>(
    () =>
      data.length > 0
        ? Object.keys(data[0]).map((key, i) => ({
            accessorKey: key,
            header: key,
            id: String(i),
          }))
        : [],
    [data],
  );

  const table = useMaterialReactTable({
    columns,
    data,
    enableRowSelection: true,
    enableColumnOrdering: true,
    enableGlobalFilter: false,
  });

  return <MaterialReactTable table={table} />;
}

function SummaryDisplay({ summary }: { summary: Summary[] }) {
  return (
    <div>
      {summary.map((item, index) => {
        if (item.type == "numeric") {
          return (
            <div key={index}>
              <h3>Numeric Summary</h3>
              <p>Column Name: {item.columnName}</p>
              <p>Not Null Count: {item.notNullCount ?? "N/A"}</p>
              <p>Null Count: {item.nullCount ?? "N/A"}</p>
              <p>Min: {item.min ?? "N/A"}</p>
              <p>Q1: {item.q1 ?? "N/A"}</p>
              <p>Median: {item.median ?? "N/A"}</p>
              <p>Q3: {item.q3 ?? "N/A"}</p>
              <p>Max: {item.max ?? "N/A"}</p>
              <p>Mean: {item.mean ?? "N/A"}</p>
            </div>
          );
        }

        if (item.type == "categorical") {
          return (
            <div key={index}>
              <h3>Categorical Summary</h3>
              <p>Column Name: {item.columnName}</p>
              <p>Not Null Count: {item.notNullCount ?? "N/A"}</p>
              <p>Null Count: {item.nullCount ?? "N/A"}</p>
              <h4>Value Counts:</h4>
              {item.valueCounts ? (
                <ul>
                  {item.valueCounts.map((vc, vcIndex) => (
                    <li key={vcIndex}>
                      Value: {vc.value}, Count: {vc.count ?? "N/A"}, Prop:{" "}
                      {vc.prop ?? "N/A"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>N/A</p>
              )}
            </div>
          );
        }

        if (item.type == "other") {
          return (
            <div key={index}>
              <h3>Other Summary</h3>
              <p>Column Name: {item.columnName}</p>
              <p>Not Null Count: {item.notNullCount ?? "N/A"}</p>
              <p>Null Count: {item.nullCount ?? "N/A"}</p>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

function App() {
  const [data, setData] = useState<DataFrame>([]);
  const [filePath, setFilePath] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [schema, setSchema] = useState<Schema>([]);
  const [summary, setSummary] = useState<Summary[]>([]);

  useEffect(() => {
    extractData().then((result) => {
      setFilePath(result.filePath);
      setData(result.df);
      setSchema(result.schema);
      setSummary(result.summary);
      setQuery(generateDefaultQuery(result.df));
    });
  }, []);

  return (
    <main className="container">
      <FileInput
        filePath={filePath}
        onChange={(filePath) => {
          invoke("register_data", { filePath });
          extractData().then((result) => {
            setFilePath(result.filePath);
            setData(result.df);
            setSchema(result.schema);
            setSummary(result.summary);
            setQuery(generateDefaultQuery(result.df));
          });
        }}
        fileType="csv"
      />
      <Box>
        {schema.map((field, index) => (
          <Typography key={index} variant="body1">
            {`${field.name}: ${field.dtype}`}
          </Typography>
        ))}
      </Box>
      <TextField
        id="sql-text-area"
        label="SQL Query"
        multiline
        maxRows={10}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setQuery(format(query))}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        sx={{
          ".MuiInputBase-input": {
            fontFamily: "monospace",
          },
        }}
      />
      <Button
        onClick={() => {
          extractData(query).then((result) => {
            setData(result.df);
            setSummary(result.summary);
          });
        }}
      >
        Execute
      </Button>
      <Button
        onClick={() => {
          extractData().then((result) => {
            setData(result.df);
            setSummary(result.summary);
          });
        }}
      >
        Reset
      </Button>
      <Table data={data} />
      <SummaryDisplay summary={summary} />
    </main>
  );
}

export default App;
