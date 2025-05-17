import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import {
  MaterialReactTable,
  useMaterialReactTable,
  type MRT_ColumnDef,
} from "material-react-table";
import { useMemo } from "react";

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

interface TableProps {
  data: Row[];
}

function Table({ data }: TableProps) {
  const columns = useMemo<MRT_ColumnDef<Record<string, any>>[]>(
    () =>
      data.length > 0
        ? Object.keys(data[0]).map((key) => ({
            accessorKey: key,
            header: key.charAt(0).toUpperCase() + key.slice(1),
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

  useEffect(() => {
    extractData().then((data) => {
      setFilePath(data.filePath);
      setData(data.df);
    });
  }, []);

  return (
    <main className="container">
      <FileInput
        filePath={filePath}
        onChange={(filePath) => setFilePath(filePath)}
        fileType="csv"
      />
      <Table data={data} />
    </main>
  );
}

export default App;
