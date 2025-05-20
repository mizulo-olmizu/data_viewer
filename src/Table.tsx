import { useMemo } from "react";
import {
  MaterialReactTable,
  useMaterialReactTable,
  type MRT_ColumnDef,
} from "material-react-table";
import { DataFrame } from "./types";

export interface TableProps {
  data: DataFrame;
}

export default function Table({ data }: TableProps) {
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
