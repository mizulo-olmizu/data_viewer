import { useMemo, useRef, useState } from "react";
import { DataFrame, Schema } from "./types";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LuArrowUp, LuArrowDown, LuArrowUpDown } from "react-icons/lu";
import { Button } from "@/components/ui/button";

export interface TableProps {
  data: DataFrame;
  schema: Schema;
  onSortError?: (error: unknown) => void;
}

export default function DataTable({ data, schema }: TableProps) {
  if (data.length === 0) {
    return <EmptyData />;
  }

  const [sorting, setSorting] = useState<SortingState>([]);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const columns = useMemo<ColumnDef<Record<string, any>>[]>(
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
                  {col.columnType}
                </TypographyTruncate>
              </div>
            </div>
            <Button
              asChild
              className="ml-2 h-4 w-4 cursor-pointer"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              {column.getIsSorted() === "asc" ? (
                <LuArrowUp />
              ) : column.getIsSorted() === "desc" ? (
                <LuArrowDown />
              ) : (
                <LuArrowUpDown />
              )}
            </Button>
          </div>
        ),
        id: col.columnName,
        maxSize: 300,
        accessorFn: (row) =>
          ["nested", "boolean", "other"].includes(col.columnDtypeGroup.type)
            ? JSON.stringify(row[col.columnName])
            : row[col.columnName],
      })),
    [data],
  );

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

  return (
    <div ref={tableContainerRef} className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader className="sticky">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id}>
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
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="text-end">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
