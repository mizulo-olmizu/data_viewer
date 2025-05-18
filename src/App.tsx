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

type SchemaField = Record<string, string>;
interface Schema {
  fields: SchemaField[];
}

interface ExtractDataProps {
  filePath: string;
  df: string;
  schema: string;
}

async function extractData() {
  const data: ExtractDataProps = await invoke("extract_data");
  const dfJson = data.df;
  const dfParsed: Row[] = JSON.parse(dfJson);
  const schemaJson = data.schema;
  const schemaParsed: Schema = JSON.parse(schemaJson);
  return { filePath: data.filePath, df: dfParsed, schema: schemaParsed };
}

async function executeQuery(query: string) {
  const jsonString: string = await invoke("execute_query", { query });
  const parsedData: Row[] = JSON.parse(jsonString);
  return parsedData;
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

function App() {
  const [data, setData] = useState<Row[]>([]);
  const [filePath, setFilePath] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [schema, setSchema] = useState<SchemaField[]>([]);

  useEffect(() => {
    extractData().then((data) => {
      setFilePath(data.filePath);
      setData(data.df);
      setSchema(data.schema.fields);
      setQuery(generateDefaultQuery(data.df));
    });
  }, []);

  return (
    <main className="container">
      <FileInput
        filePath={filePath}
        onChange={(filePath) => {
          invoke("register_data", { filePath });
          extractData().then((data) => {
            setFilePath(data.filePath);
            setData(data.df);
            setSchema(data.schema.fields);
            setQuery(generateDefaultQuery(data.df));
          });
        }}
        fileType="csv"
      />
      <Box>
        {Object.entries(schema).map(([key, val], index) => (
          <Typography key={index} variant="body1">
            {`${key}: ${val}`}
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
          executeQuery(query).then((data) => setData(data));
        }}
      >
        Execute
      </Button>
      <Button
        onClick={() => {
          extractData().then((data) => {
            setData(data.df);
          });
        }}
      >
        Reset
      </Button>
      <Table data={data} />
    </main>
  );
}

export default App;
