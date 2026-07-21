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
import DebouncedInput from "@/components/DebouncedInput";
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
import { ItemProps, TableVirtuoso, TableVirtuosoHandle } from "react-virtuoso";
import { cn } from "@/lib/utils";
import ColumnVisibilityMenu from "@/components/ColumnVisibilityMenu";
import ExportActions from "@/components/ExportActions";
import AdvancedFilterPanel from "@/components/AdvancedFilterPanel";
import {
  applyAdvancedFilter,
  isConditionActive,
  type FilterCombinator,
  type FilterCondition,
} from "./advancedFilter";
import { toCsv, toTsv } from "./csv";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
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
      className="flex w-full items-center justify-end gap-1"
    >
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

interface CellPos {
  rowIndex: number;
  colIndex: number;
}

interface CellSelection {
  anchor: CellPos;
  focus: CellPos;
}

interface SelectionContext {
  rowIndex: number;
  colIndex: number;
  selection: CellSelection | null;
  onMouseDown: (pos: CellPos, shiftKey: boolean) => void;
  onMouseEnter: (pos: CellPos) => void;
}

function isCellSelected(selection: CellSelection | null, pos: CellPos) {
  if (!selection) {
    return false;
  }

  const rowMin = Math.min(selection.anchor.rowIndex, selection.focus.rowIndex);
  const rowMax = Math.max(selection.anchor.rowIndex, selection.focus.rowIndex);
  const colMin = Math.min(selection.anchor.colIndex, selection.focus.colIndex);
  const colMax = Math.max(selection.anchor.colIndex, selection.focus.colIndex);

  return (
    pos.rowIndex >= rowMin &&
    pos.rowIndex <= rowMax &&
    pos.colIndex >= colMin &&
    pos.colIndex <= colMax
  );
}

function renderBodyCell(
  cell: Cell<Row, unknown>,
  dragState: ColumnDragState,
  selectionCtx: SelectionContext,
) {
  const column = cell.column;
  const isPinned = column.getIsPinned();
  const isActive = dragState.activeColumnId === column.id;
  const transform = dragState.transforms[column.id];
  const isDisplaced = !!transform && (transform.x !== 0 || transform.y !== 0);
  const pos: CellPos = {
    rowIndex: selectionCtx.rowIndex,
    colIndex: selectionCtx.colIndex,
  };
  const isSelected = isCellSelected(selectionCtx.selection, pos);

  return (
    <TableCell
      key={cell.id}
      className={cn(
        "text-end cursor-cell select-none",
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
        ...(isSelected
          ? {
              backgroundColor:
                "color-mix(in oklch, var(--primary) 18%, var(--background) 82%)",
            }
          : {}),
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        selectionCtx.onMouseDown(pos, e.shiftKey);
      }}
      onMouseEnter={() => selectionCtx.onMouseEnter(pos)}
    >
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </TableCell>
  );
}

export interface TableProps {
  data: DataFrame;
  schema: Schema;
  tableName?: string;
  onSortError?: (error: unknown) => void;
  onInsertToQuery?: (text: string) => void;
  sqlEditorOpen?: boolean;
}

// 列の並び順(columnOrder)・表示/非表示(columnVisibility)・Pin(columnPinning)は独立したstateであり、
// お互いの配列を書き換えない。Pin中/非表示中の列もcolumnOrder配列内には「その場所にいるまま」残り続け、
// レンダリングから除外されるだけなので、その間に周囲の列を並び替えると配列のシフトに応じて自然に
// 位置が押し出される(隣接列との相対関係は保たれる)。Unpin/再表示すると、その時点のcolumnOrder上の
// 位置にそのまま復帰する。
export default function DataTable({
  data,
  schema,
  tableName,
  onInsertToQuery,
  sqlEditorOpen,
}: TableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [advancedFilterConditions, setAdvancedFilterConditions] = useState<
    FilterCondition[]
  >([]);
  const [advancedFilterCombinator, setAdvancedFilterCombinator] =
    useState<FilterCombinator>("and");
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
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const isSelectingRef = useRef(false);
  const virtuosoRef = useRef<TableVirtuosoHandle>(null);

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
    setGlobalFilter("");
    setAdvancedFilterConditions([]);
    setAdvancedFilterCombinator("and");
    setColumnVisibility({});
    setColumnOrder(schema.map((col) => col.columnName));
    setColumnPinning({ left: [], right: [] });
    setColumnTransforms({});
    setSelection(null);
  }

  // ドラッグ選択中にセルの外でマウスボタンを離した場合も選択を確定させる
  useEffect(() => {
    const handleMouseUp = () => {
      isSelectingRef.current = false;
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // 全体検索(tanstack-table側のglobalFilterで処理される)とは独立したレイヤーとして、
  // 高度なフィルタをuseReactTableに渡す手前で適用する。
  const filteredData = useMemo(
    () =>
      applyAdvancedFilter(
        data,
        advancedFilterConditions,
        advancedFilterCombinator,
        schema,
      ),
    [data, advancedFilterConditions, advancedFilterCombinator, schema],
  );

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
      })),
    [schema, handleTransformChange],
  );

  // 行/列の並びに影響する変更が起きたら、位置(rowIndex/colIndex)で管理している選択範囲は
  // 意味を失うのでリセットする
  //
  // tanstack-tableのuseReactTableはメモ化できない関数を返す仕様のため、React Compiler向けの警告が出るが
  // このプロジェクトはReact Compilerを導入していないため実害はない
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: (updater) => {
      setSelection(null);
      setSorting(updater);
    },
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onGlobalFilterChange: (updater) => {
      setSelection(null);
      setGlobalFilter(updater);
    },
    globalFilterFn: "includesString",
    onColumnVisibilityChange: (updater) => {
      setSelection(null);
      setColumnVisibility(updater);
    },
    onColumnOrderChange: (updater) => {
      setSelection(null);
      setColumnOrder(updater);
    },
    onColumnPinningChange: (updater) => {
      setSelection(null);
      setColumnPinning(updater);
    },
    state: {
      sorting,
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
  const orderedColumnIds = [...leftIds, ...centerIds];
  const columnIndexById = new Map(
    orderedColumnIds.map((id, index) => [id, index]),
  );

  // 高度なフィルタはtanstack-tableのコールバック経由ではなくAdvancedFilterPanelからの
  // 直接のstate更新なので、他のフィルタ変更と同様にここでも選択範囲をリセットする
  const handleAdvancedFilterConditionsChange = (
    conditions: FilterCondition[],
  ) => {
    setSelection(null);
    setAdvancedFilterConditions(conditions);
  };
  const handleAdvancedFilterCombinatorChange = (
    combinator: FilterCombinator,
  ) => {
    setSelection(null);
    setAdvancedFilterCombinator(combinator);
  };

  // 表示上の並び順(Pin列→通常列)・表示/非表示・フィルタ/ソート後の内容をそのままCSVにする
  const getCsv = () => {
    const csvRows = rows.map((row) =>
      orderedColumnIds.map((columnId) => row.getValue(columnId)),
    );

    return toCsv(orderedColumnIds, csvRows);
  };

  const dragState: ColumnDragState = {
    activeColumnId,
    transforms: columnTransforms,
  };

  const handleCellMouseDown = (pos: CellPos, shiftKey: boolean) => {
    isSelectingRef.current = true;
    setSelection((prev) =>
      shiftKey && prev
        ? { anchor: prev.anchor, focus: pos }
        : { anchor: pos, focus: pos },
    );
    // セル側のmousedownでpreventDefault()しているため、ブラウザ標準のフォーカス移動が
    // 起きない。矢印キー操作やCmd/Ctrl+Cコピーを受け取れるよう、コンテナへ明示的にフォーカスする。
    tableContainerRef.current?.focus();
  };

  const handleCellMouseEnter = (pos: CellPos) => {
    if (!isSelectingRef.current) return;
    setSelection((prev) =>
      prev ? { anchor: prev.anchor, focus: pos } : { anchor: pos, focus: pos },
    );
  };

  const copySelection = () => {
    if (!selection) return;

    const rowMin = Math.min(
      selection.anchor.rowIndex,
      selection.focus.rowIndex,
    );
    const rowMax = Math.max(
      selection.anchor.rowIndex,
      selection.focus.rowIndex,
    );
    const colMin = Math.min(
      selection.anchor.colIndex,
      selection.focus.colIndex,
    );
    const colMax = Math.max(
      selection.anchor.colIndex,
      selection.focus.colIndex,
    );
    const columnIds = orderedColumnIds.slice(colMin, colMax + 1);

    // 選択範囲自体は行番号・列見出しを含まないが、貼り付け先で何のデータか
    // 分かるよう、コピー時は先頭行に列名、各行の先頭に行番号を付与する
    const headerRow = ["", ...columnIds];
    const dataRows = rows
      .slice(rowMin, rowMax + 1)
      .map((row) => [
        row.index + 1,
        ...columnIds.map((columnId) => row.getValue(columnId)),
      ]);

    writeText(toTsv([headerRow, ...dataRows]))
      .then(() => toast("コピーしました"))
      .catch((err) => toast.error(`コピーに失敗しました: ${err}`));
  };

  const handleContainerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      if (selection) {
        e.preventDefault();
        copySelection();
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      if (selection) {
        e.preventDefault();
        setSelection({
          anchor: { rowIndex: 0, colIndex: 0 },
          focus: {
            rowIndex: rows.length - 1,
            colIndex: orderedColumnIds.length - 1,
          },
        });
      }
      return;
    }

    if (!selection) return;

    const deltas: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = deltas[e.key];
    if (!delta) return;

    e.preventDefault();
    const maxRow = rows.length - 1;
    const maxCol = orderedColumnIds.length - 1;
    const clamp = (value: number, max: number) =>
      Math.min(Math.max(value, 0), max);
    const newFocus: CellPos = {
      rowIndex: clamp(selection.focus.rowIndex + delta[0], maxRow),
      colIndex: clamp(selection.focus.colIndex + delta[1], maxCol),
    };

    setSelection({
      anchor: e.shiftKey ? selection.anchor : newFocus,
      focus: newFocus,
    });
    virtuosoRef.current?.scrollToIndex(newFocus.rowIndex);
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
          {[...row.getLeftVisibleCells(), ...row.getCenterVisibleCells()].map(
            (cell) =>
              renderBodyCell(cell, dragState, {
                rowIndex: row.index,
                colIndex: columnIndexById.get(cell.column.id) ?? -1,
                selection,
                onMouseDown: handleCellMouseDown,
                onMouseEnter: handleCellMouseEnter,
              }),
          )}
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
        <AdvancedFilterPanel
          schema={schema}
          conditions={advancedFilterConditions}
          combinator={advancedFilterCombinator}
          onConditionsChange={handleAdvancedFilterConditionsChange}
          onCombinatorChange={handleAdvancedFilterCombinatorChange}
          onInsertToQuery={onInsertToQuery}
          sqlEditorOpen={sqlEditorOpen}
        />
        {(globalFilter !== "" ||
          advancedFilterConditions.some((c) =>
            isConditionActive(c, schema),
          )) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setGlobalFilter("");
              setAdvancedFilterConditions([]);
              setAdvancedFilterCombinator("and");
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
        <ExportActions
          getCsv={getCsv}
          defaultFileName={`${tableName ?? "table"}.csv`}
        />
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
          tabIndex={0}
          onKeyDown={handleContainerKeyDown}
          onBlur={() => setSelection(null)}
          className="min-h-0 flex-1 rounded-md border outline-none"
        >
          <TableVirtuoso
            ref={virtuosoRef}
            totalCount={filteredData.length}
            components={components}
            fixedHeaderContent={fixedHeaderContent}
          />
        </div>
      </DndContext>
    </div>
  );
}
