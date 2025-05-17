import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import {
  MaterialReactTable,
  useMaterialReactTable,
  type MRT_ColumnDef,
} from "material-react-table";
import { useMemo } from "react";

type Row = Record<string, any>;

interface TableProps {
  data: Row[];
}

async function extractData() {
  const jsonString: string = await invoke("extract_data");
  const parsedData: Row[] = JSON.parse(jsonString);
  return parsedData;
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

  useEffect(() => {
    extractData().then((data) => setData(data));
  }, []);

  return (
    <main className="container">
      <Table data={data} />
    </main>
  );
}

export default App;
