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

import FileInput from "./FileInput";

type Row = Record<string, any>;

interface ExtractDataProps {
  filePath: string;
  df: string;
}

async function extractData() {
  const data: ExtractDataProps = await invoke("extract_data");
  const jsonString: string = data.df;
  const parsedData: Row[] = JSON.parse(jsonString);
  return { filePath: data.filePath, df: parsedData };
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

  useEffect(() => {
    extractData().then((data) => {
      setFilePath(data.filePath);
      setData(data.df);
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
            setQuery(generateDefaultQuery(data.df));
          });
        }}
        fileType="csv"
      />
      <TextField
        id="sql-text-area"
        label="SQL Query"
        multiline
        rows={10}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setQuery(format(query))}
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
