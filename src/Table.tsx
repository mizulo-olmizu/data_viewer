import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { DataFrame, Row, Schema, ColumnInfo } from "./types";
import TypeIcon from "./TypeIcon";
import TypographyTruncate from "./TypographyTruncate";
import EmptyData from "./EmptyData";
import {
  Cell,
  Column,
  ColumnDef,
  ColumnFiltersState,
  ColumnOrderState,
  ColumnPinningState,
  Header,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  LuArrowUp,
  LuArrowDown,
  LuArrowUpDown,
  LuGripVertical,
  LuPin,
  LuPinOff,
  LuSearch,
  LuX,
} from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { ItemProps, TableVirtuoso } from "react-virtuoso";
import { cn } from "@/lib/utils";
import ColumnVisibilityMenu from "@/components/ColumnVisibilityMenu";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";

// 行番号列の幅(px)。常に表示され、並び替え/Pin/表示切り替えの対象外の固定列。
const INDEX_COLUMN_WIDTH = 56;

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

function TableComponent({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLTableElement> & { ref?: Ref<HTMLTableElement> }) {
  return (
    <table
      ref={ref}
      className={cn("w-full table-fixed caption-bottom text-sm", className)}
      {...props}
    />
  );
}

function DebouncedInput({
  value: externalValue,
  onChange,
  debounce = 300,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  debounce?: number;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  const [value, setValue] = useState(externalValue);
  const [prevExternalValue, setPrevExternalValue] = useState(externalValue);

  if (externalValue !== prevExternalValue) {
    setPrevExternalValue(externalValue);
    setValue(externalValue);
  }

  // onChangeは呼び出し側で毎レンダー新しい関数になりうる(例: カラムごとのフィルタ)。
  // 依存配列にonChangeそのものを入れると、onChangeの参照が変わるたびにタイマーが再セットされ、
  // 「setFilterValue→再レンダー→onChange再生成→タイマー再セット」の無限ループになるため、
  // refで最新のonChangeを参照しつつ、effectの再実行はvalue/debounceの変化のみに限定する。
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const timeout = setTimeout(() => {
      onChangeRef.current(value);
    }, debounce);

    return () => clearTimeout(timeout);
  }, [value, debounce]);

  return (
    <Input
      {...props}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

interface ColumnTransform {
  x: number;
  y: number;
  transition?: string;
}

interface HeaderCellContentProps {
  column: Column<Row, unknown>;
  columnInfo: ColumnInfo;
  onTransformChange: (id: string, transform: ColumnTransform | null) => void;
}

function HeaderCellContent({
  column,
  columnInfo,
  onTransformChange,
}: HeaderCellContentProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });
  const isPinned = column.getIsPinned();
  const filterValue = (column.getFilterValue() as string | undefined) ?? "";

  // ドラッグでヘッダーが動く(押しのけられる)のと同じ量だけ、bodyの該当列のセルも
  // 一緒に動かすため、このヘッダーが持つ最新のtransformを親(DataTable)へ都度報告する。
  useEffect(() => {
    onTransformChange(
      column.id,
      transform ? { x: transform.x, y: transform.y, transition } : null,
    );
  }, [column.id, transform, transition, onTransformChange]);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className="flex w-full flex-col gap-1"
    >
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="text-muted-foreground hover:text-foreground shrink-0 cursor-grab touch-none active:cursor-grabbing"
        >
          <LuGripVertical className="h-3.5 w-3.5" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-end gap-0">
          <TypographyTruncate className="font-bold">
            {columnInfo.columnName}
          </TypographyTruncate>
          <div className="flex justify-start items-center gap-0.5">
            <TypeIcon
              dtypeGroup={columnInfo.columnDtypeGroup.type}
              fontSize="small"
            />
            <TypographyTruncate className="text-sx">
              {serialize(columnInfo.columnType)}
            </TypographyTruncate>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-4 w-4 shrink-0 cursor-pointer"
          onClick={() => column.pin(isPinned ? false : "left")}
        >
          {isPinned ? (
            <LuPinOff className="text-foreground" />
          ) : (
            <LuPin className="text-foreground" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-4 w-4 shrink-0 cursor-pointer"
          onClick={() => column.toggleSorting()}
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
      <DebouncedInput
        value={filterValue}
        onChange={(value) => column.setFilterValue(value || undefined)}
        placeholder="Filter..."
        className="h-6 px-1.5 text-xs"
      />
    </div>
  );
}

function renderHeaderCell(header: Header<Row, unknown>) {
  const column = header.column;
  const isPinned = column.getIsPinned();

  return (
    <TableHead
      key={header.id}
      colSpan={header.colSpan}
      style={{
        width: header.getSize(),
        ...(isPinned
          ? {
              position: "sticky" as const,
              left: INDEX_COLUMN_WIDTH + column.getStart("left"),
              zIndex: 2,
            }
          : {}),
      }}
      className="bg-background"
    >
      {header.isPlaceholder
        ? null
        : flexRender(header.column.columnDef.header, header.getContext())}
    </TableHead>
  );
}

interface ColumnDragState {
  activeColumnId: string | null;
  transforms: Record<string, ColumnTransform | null>;
}

function renderBodyCell(cell: Cell<Row, unknown>, dragState: ColumnDragState) {
  const column = cell.column;
  const isPinned = column.getIsPinned();
  const isActive = dragState.activeColumnId === column.id;
  const transform = dragState.transforms[column.id];
  const isDisplaced = !!transform && (transform.x !== 0 || transform.y !== 0);

  return (
    <TableCell
      key={cell.id}
      className={cn(
        "text-end",
        isPinned &&
          "bg-background group-hover:bg-[color-mix(in_oklch,var(--muted)_50%,var(--background)_50%)]",
        isActive && "bg-background",
      )}
      style={{
        width: column.getSize(),
        ...(isPinned
          ? {
              position: "sticky" as const,
              left: INDEX_COLUMN_WIDTH + column.getStart("left"),
              zIndex: isActive ? 2 : 1,
            }
          : isDisplaced
            ? { position: "relative" as const, zIndex: isActive ? 2 : 1 }
            : {}),
        ...(isDisplaced
          ? {
              transform: `translateX(${transform.x}px)`,
              transition: transform.transition,
              opacity: isActive ? 0.6 : 1,
            }
          : {}),
      }}
    >
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </TableCell>
  );
}

export interface TableProps {
  data: DataFrame;
  schema: Schema;
  onSortError?: (error: unknown) => void;
}

// 列の並び順(columnOrder)・表示/非表示(columnVisibility)・Pin(columnPinning)は独立したstateであり、
// お互いの配列を書き換えない。Pin中/非表示中の列もcolumnOrder配列内には「その場所にいるまま」残り続け、
// レンダリングから除外されるだけなので、その間に周囲の列を並び替えると配列のシフトに応じて自然に
// 位置が押し出される(隣接列との相対関係は保たれる)。Unpin/再表示すると、その時点のcolumnOrder上の
// 位置にそのまま復帰する。
export default function DataTable({ data, schema }: TableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() =>
    schema.map((col) => col.columnName),
  );
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({
    left: [],
    right: [],
  });
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const [columnTransforms, setColumnTransforms] = useState<
    Record<string, ColumnTransform | null>
  >({});

  // HeaderCellContentから毎レンダー渡ってくるコールバックの参照が変わっても、
  // ドラッグ中に何度も呼ばれるこの通知自体は再セットの必要が無いため、参照を安定させておく。
  // useSortableのtransformは値が変わっていなくても毎レンダー新しいオブジェクトになりうるため、
  // 値が実際に変わった場合のみstateを更新する(でないと更新→再レンダー→transform再生成→更新…の
  // 無限ループになる)。
  const handleTransformChange = useCallback(
    (id: string, transform: ColumnTransform | null) => {
      setColumnTransforms((prev) => {
        const existing = prev[id] ?? null;
        const unchanged =
          existing === transform ||
          (existing !== null &&
            transform !== null &&
            existing.x === transform.x &&
            existing.y === transform.y &&
            existing.transition === transform.transition);

        if (unchanged) {
          return prev;
        }

        return { ...prev, [id]: transform };
      });
    },
    [],
  );

  // テーブル切り替え時に、前のテーブルのフィルタ・非表示カラム・並び替え・Pin状態が残らないようにリセットする
  const [prevSchema, setPrevSchema] = useState(schema);
  if (schema !== prevSchema) {
    setPrevSchema(schema);
    setSorting([]);
    setColumnFilters([]);
    setGlobalFilter("");
    setColumnVisibility({});
    setColumnOrder(schema.map((col) => col.columnName));
    setColumnPinning({ left: [], right: [] });
    setColumnTransforms({});
  }

  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      schema.map((col) => ({
        header: ({ column }) => (
          <HeaderCellContent
            column={column}
            columnInfo={col}
            onTransformChange={handleTransformChange}
          />
        ),
        id: col.columnName,
        maxSize: 300,
        accessorFn: (row) => serialize(row[col.columnName]),
        filterFn: "includesString",
      })),
    [schema, handleTransformChange],
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
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: "includesString",
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnPinningChange: setColumnPinning,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      columnVisibility,
      columnOrder,
      columnPinning,
    },
  });

  const { rows } = table.getRowModel();

  const leftHeaders = table.getLeftHeaderGroups()[0]?.headers ?? [];
  const centerHeaders = table.getCenterHeaderGroups()[0]?.headers ?? [];
  const leftIds = table.getLeftVisibleLeafColumns().map((column) => column.id);
  const centerIds = table
    .getCenterVisibleLeafColumns()
    .map((column) => column.id);

  const dragState: ColumnDragState = {
    activeColumnId,
    transforms: columnTransforms,
  };

  const components = {
    Table: TableComponent,
    TableRow: (props: ItemProps<Row>) => {
      const index = props["data-index"];
      const row = rows[index];

      if (!row) return null;

      return (
        <TableRow
          key={row.id}
          data-state={row.getIsSelected() && "selected"}
          className="group relative z-0"
          {...props}
        >
          <TableCell
            className="bg-background group-hover:bg-[color-mix(in_oklch,var(--muted)_50%,var(--background)_50%)] text-end"
            style={{
              width: INDEX_COLUMN_WIDTH,
              position: "sticky",
              left: 0,
              zIndex: 1,
            }}
          >
            {row.index + 1}
          </TableCell>
          {row
            .getLeftVisibleCells()
            .map((cell) => renderBodyCell(cell, dragState))}
          {row
            .getCenterVisibleCells()
            .map((cell) => renderBodyCell(cell, dragState))}
        </TableRow>
      );
    },
  };

  const fixedHeaderContent = () => (
    <TableRow className="relative z-0">
      <TableHead
        className="bg-background"
        style={{
          width: INDEX_COLUMN_WIDTH,
          position: "sticky",
          left: 0,
          zIndex: 2,
        }}
      />
      <SortableContext items={leftIds} strategy={horizontalListSortingStrategy}>
        {leftHeaders.map(renderHeaderCell)}
      </SortableContext>
      <SortableContext
        items={centerIds}
        strategy={horizontalListSortingStrategy}
      >
        {centerHeaders.map(renderHeaderCell)}
      </SortableContext>
    </TableRow>
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveColumnId(event.active.id as string);
  };

  const handleDragEndOrCancel = () => {
    setActiveColumnId(null);
    setColumnTransforms({});
  };

  const handleDragEnd = (event: DragEndEvent) => {
    handleDragEndOrCancel();

    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;
    const activeIsPinned = columnPinning.left?.includes(activeId) ?? false;
    const overIsPinned = columnPinning.left?.includes(overId) ?? false;

    if (activeIsPinned !== overIsPinned) {
      // Pin済み/未Pinのグループを跨ぐドロップは対象外(Pinの切り替えはPinボタンから行う)
      return;
    }

    if (activeIsPinned) {
      setColumnPinning((prev) => {
        const left = prev.left ?? [];
        const oldIndex = left.indexOf(activeId);
        const newIndex = left.indexOf(overId);
        return { ...prev, left: arrayMove(left, oldIndex, newIndex) };
      });
    } else {
      setColumnOrder((prev) => {
        const oldIndex = prev.indexOf(activeId);
        const newIndex = prev.indexOf(overId);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  if (data.length === 0) {
    return <EmptyData />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative w-64">
          <LuSearch className="text-muted-foreground pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <DebouncedInput
            value={globalFilter}
            onChange={setGlobalFilter}
            placeholder="Search all columns..."
            className="h-8 pl-7 pr-7"
          />
          {globalFilter !== "" && (
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-0.5 top-1/2 h-6 w-6 -translate-y-1/2 cursor-pointer"
              onClick={() => setGlobalFilter("")}
            >
              <LuX className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {(columnFilters.length > 0 || globalFilter !== "") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setColumnFilters([]);
              setGlobalFilter("");
            }}
          >
            Clear filters
          </Button>
        )}
        {sorting.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => table.resetSorting()}
          >
            Clear sort
          </Button>
        )}
        <div className="flex-1" />
        <ColumnVisibilityMenu
          columns={table.getAllLeafColumns().map((column) => ({
            id: column.id,
            label: column.id,
            visible: column.getIsVisible(),
          }))}
          onToggle={(id) => table.getColumn(id)?.toggleVisibility()}
          onShowAll={() => table.toggleAllColumnsVisible(true)}
          onHideAll={() => table.toggleAllColumnsVisible(false)}
        />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragEndOrCancel}
      >
        <div
          ref={tableContainerRef}
          className="min-h-0 flex-1 rounded-md border"
        >
          <TableVirtuoso
            totalCount={data.length}
            components={components}
            fixedHeaderContent={fixedHeaderContent}
          />
        </div>
      </DndContext>
    </div>
  );
}
