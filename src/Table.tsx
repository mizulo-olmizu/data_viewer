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
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";

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
  const columns = useMemo<MRT_ColumnDef<Record<string, any>>[]>(
    () =>
      schema.map((col) => ({
        // accessorKey: key,
        header: col.name,
        id: col.name,
        accessorFn: (row) =>
          ["nested", "boolean", "other"].includes(col.dtypeGroup.type)
            ? JSON.stringify(row[col.name])
            : row[col.name],
        Header: ({ column }) => (
          <Stack
            alignItems="center"
            direction="row"
            justifyContent="left"
            gap={0.5}
          >
            <TypeIcon dtypeGroup={col.dtypeGroup.type} fontSize="small" />
            <Tooltip title={column.columnDef.header} placement="top">
              <div className="txt-trunc">{column.columnDef.header}</div>
            </Tooltip>
          </Stack>
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
