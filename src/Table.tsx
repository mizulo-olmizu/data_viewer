import { useEffect, useMemo, useRef, useState } from "react";
import {
  MaterialReactTable,
  useMaterialReactTable,
  type MRT_ColumnDef,
  type MRT_SortingState,
  type MRT_RowVirtualizer,
} from "material-react-table";
import { DataFrame, Schema } from "./types";
import TypeIcon from "./TypeIcon";
import TypographyTruncate from "./TypographyTruncate";
import EmptyData from "./EmptyData";

export interface TableProps {
  data: DataFrame;
  schema: Schema;
  onSortError?: (error: unknown) => void;
}

export default function Table({
  data,
  schema,
  onSortError = () => {},
}: TableProps) {
  if (data.length === 0) {
    return <EmptyData />;
  }

  const columns = useMemo<MRT_ColumnDef<Record<string, any>>[]>(
    () =>
      schema.map((col) => ({
        // accessorKey: key,
        header: col.columnName,
        id: col.columnName,
        maxSize: 300,
        accessorFn: (row) =>
          ["nested", "boolean", "other"].includes(col.columnDtypeGroup.type)
            ? JSON.stringify(row[col.columnName])
            : row[col.columnName],
        Header: ({ column }) => (
          <div className="flex flex-col gap-0">
            <TypographyTruncate className="font-bold">
              {column.columnDef.header}
            </TypographyTruncate>
            <div className="flex justify-start items-center gap-0.5">
              <TypeIcon
                dtypeGroup={col.columnDtypeGroup.type}
                fontSize="small"
              />
              <TypographyTruncate className="text-sx">
                {col.columnType}
              </TypographyTruncate>
            </div>
          </div>
        ),
      })),
    [data],
  );

  const rowVirtualizerInstanceRef = useRef<MRT_RowVirtualizer>(null);
  const [sorting, setSorting] = useState<MRT_SortingState>([]);

  useEffect(() => {
    try {
      rowVirtualizerInstanceRef.current?.scrollToIndex?.(0);
    } catch (error) {
      onSortError(error);
    }
  }, [sorting]);

  const table = useMaterialReactTable({
    columns,
    data,
    enableRowSelection: false,
    enableGlobalFilter: false,
    enableBottomToolbar: false,
    enableGlobalFilterModes: true,
    enablePagination: false,
    enableRowNumbers: true,
    rowNumberDisplayMode: "original",
    enableRowVirtualization: true,
    muiTableContainerProps: { sx: { height: "100%" } },
    onSortingChange: setSorting,
    state: { sorting },
    rowVirtualizerInstanceRef,
    rowVirtualizerOptions: { overscan: 5 },
  });

  return <MaterialReactTable table={table} />;
}
