import { useMemo, useRef, useState, type Ref } from "react";
import { DataFrame, Row, Schema } from "./types";
import TypeIcon from "./TypeIcon";
import TypographyTruncate from "./TypographyTruncate";
import EmptyData from "./EmptyData";
import {
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { LuArrowUp, LuArrowDown, LuArrowUpDown } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { TableVirtuoso } from "react-virtuoso";
import { cn } from "@/lib/utils";

function isPrimitive<T>(value: T) {
  return (
    value === null || (typeof value !== "object" && typeof value !== "function")
  );
}

function serialize<T>(value: T): T | string {
  if (isPrimitive(value)) {
    return value;
  }

  return JSON.stringify(value);
}

export interface TableProps {
  data: DataFrame;
  schema: Schema;
  onSortError?: (error: unknown) => void;
}

export default function DataTable({ data, schema }: TableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      schema.map((col) => ({
        header: ({ column }) => (
          <div className="flex items-center justify-end gap-2">
            <div className="flex flex-col gap-0 items-end">
              <TypographyTruncate className="font-bold">
                {col.columnName}
              </TypographyTruncate>
              <div className="flex justify-start items-center gap-0.5">
                <TypeIcon
                  dtypeGroup={col.columnDtypeGroup.type}
                  fontSize="small"
                />
                <TypographyTruncate className="text-sx">
                  {serialize(col.columnType)}
                </TypographyTruncate>
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="ml-2 h-4 w-4 cursor-pointer"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              {column.getIsSorted() === "asc" ? (
                <LuArrowUp className="text-foreground" />
              ) : column.getIsSorted() === "desc" ? (
                <LuArrowDown className="text-foreground" />
              ) : (
                <LuArrowUpDown className="text-foreground" />
              )}
            </Button>
          </div>
        ),
        id: col.columnName,
        maxSize: 300,
        accessorFn: (row) => serialize(row[col.columnName]),
      })),
    [schema],
  );

  // tanstack-tableのuseReactTableはメモ化できない関数を返す仕様のため、React Compiler向けの警告が出るが
  // このプロジェクトはReact Compilerを導入していないため実害はない
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    state: {
      sorting,
    },
  });

  const { rows } = table.getRowModel();

  if (data.length === 0) {
    return <EmptyData />;
  }

  function TableComponent({
    className,
    ref,
    ...props
  }: React.HTMLAttributes<HTMLTableElement> & { ref?: Ref<HTMLTableElement> }) {
    return (
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    );
  }

  return (
    <div ref={tableContainerRef} className="rounded-md border h-full">
      <TableVirtuoso
        totalCount={data.length}
        components={{
          Table: TableComponent,
          TableRow: (props) => {
            const index = props["data-index"];
            const row = rows[index];

            if (!row) return null;

            return (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
                {...props}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="text-end">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            );
          },
        }}
        fixedHeaderContent={() => {
          return table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    style={{
                      width: header.getSize(),
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ));
        }}
      />
    </div>
  );
}
