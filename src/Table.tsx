import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Row, Schema, ColumnInfo } from "./types";
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
  useReactTable,
} from "@tanstack/react-table";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import LargeCopyConfirmDialog from "@/components/LargeCopyConfirmDialog";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import ColumnVisibilityMenu from "@/components/ColumnVisibilityMenu";
import ExportActions from "@/components/ExportActions";
import AdvancedFilterPanel from "@/components/AdvancedFilterPanel";
import {
  conditionsToSql,
  globalSearchToSql,
  isConditionActive,
  type FilterCombinator,
  type FilterCondition,
} from "./advancedFilter";
import { fetchRowRange, exportTableCsv } from "./handler";
import { usePagedRows, isLoadingRow } from "./usePagedRows";
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
import {
  useCellRangeSelection,
  type CellPos,
  type CellSelection,
  isCellSelected,
  SELECTED_CELL_BACKGROUND,
} from "./useCellRangeSelection";
import GlimpseView from "./GlimpseView";
import RecordView from "./RecordView";
import { useSettings } from "@/hooks/use-settings";

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
  const isLastPinned = isPinned && column.getIsLastColumn("left");

  return (
    <TableHead
      key={header.id}
      colSpan={header.colSpan}
      style={{
        width: header.getSize(),
        // ヘッダー行は常にtop:0でsticky(仮想化された本体スクロールに対して固定表示するため)。
        // Pin列はさらにleftも固定する。列本体側と同じくthead(コンテナ)ではなく各セル単位で
        // stickyを指定する(WebKitでのsticky/コンテナ挙動の既知の相性問題を避けるため)。
        position: "sticky" as const,
        top: 0,
        left: isPinned
          ? INDEX_COLUMN_WIDTH + column.getStart("left")
          : undefined,
        // 本体セル(通常0〜2)より確実に上に来るよう、Pin列はさらに高くする
        zIndex: isPinned ? 4 : 3,
        // border-rだとposition:stickyな要素でスクロール中にWebKit(macOS Tauri)が
        // 消してしまうことがあるため、box-shadowで境界線を表現する(sticky併用時の既知の回避策)
        ...(isLastPinned ? { boxShadow: "2px 0 0 0 var(--border)" } : {}),
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

interface SelectionContext {
  rowIndex: number;
  colIndex: number;
  selection: CellSelection | null;
  onMouseDown: (pos: CellPos, shiftKey: boolean) => void;
  onMouseEnter: (pos: CellPos) => void;
}

function renderBodyCell(
  cell: Cell<Row, unknown>,
  dragState: ColumnDragState,
  selectionCtx: SelectionContext,
) {
  const column = cell.column;
  const isPinned = column.getIsPinned();
  const isLastPinned = isPinned && column.getIsLastColumn("left");
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
        ...(isSelected ? { backgroundColor: SELECTED_CELL_BACKGROUND } : {}),
        // border-rだとposition:stickyな要素でスクロール中にWebKit(macOS Tauri)が
        // 消してしまうことがあるため、box-shadowで境界線を表現する(sticky併用時の既知の回避策)
        ...(isLastPinned ? { boxShadow: "2px 0 0 0 var(--border)" } : {}),
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
  schema: Schema;
  tableName: string;
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
  const [viewMode, setViewMode] = useState<"grid" | "glimpse" | "record">(
    "grid",
  );
  const { settings } = useSettings();

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

  // テーブル切り替え時に、前のテーブルのフィルタ・非表示カラム・並び替え・Pin状態が残らないようにリセットする。
  // schemaは同じテーブル名(SQLエディタで異なるクエリを連続実行した場合の"_last"等)でもデータロードの
  // たびに新しい参照になるため、「データが読み直された」ことの信頼できる検知に使える。
  const [prevSchema, setPrevSchema] = useState(schema);
  // usePagedRowsのキャッシュ無効化キーに使う版数。tableName/sortColumn/sortDesc/whereSqlが
  // 同じ値のまま(例: ソート/フィルタ無しの状態でSQLエディタから別クエリを連続実行し、両方とも
  // "_last"という同じテーブル名になるケース)でも、データが読み直されたらキャッシュを破棄する必要が
  // あるため、tableName等だけでは区別できない「同名だが中身が変わった」を検知する目的で使う。
  const [dataVersion, setDataVersion] = useState(0);
  if (schema !== prevSchema) {
    setPrevSchema(schema);
    setDataVersion((v) => v + 1);
    setSorting([]);
    setGlobalFilter("");
    setAdvancedFilterConditions([]);
    setAdvancedFilterCombinator("and");
    setColumnVisibility({});
    setColumnOrder(schema.map((col) => col.columnName));
    setColumnPinning({ left: [], right: [] });
    setColumnTransforms({});
  }

  // 高度フィルタ・全体検索(グローバル検索ボックス)はどちらもSQLのWHERE句に変換し、
  // サーバー側(DuckDB)で評価する(以前はクライアント側でJS配列を評価していた)。
  const advancedWhereSql = useMemo(
    () =>
      conditionsToSql(
        advancedFilterConditions,
        advancedFilterCombinator,
        schema,
      ),
    [advancedFilterConditions, advancedFilterCombinator, schema],
  );
  const globalSearchWhereSql = useMemo(
    () => globalSearchToSql(globalFilter, schema),
    [globalFilter, schema],
  );
  const whereSql = useMemo(() => {
    const clauses = [advancedWhereSql, globalSearchWhereSql].filter(
      (c) => c !== "",
    );
    return clauses.length > 0 ? clauses.join(" AND ") : null;
  }, [advancedWhereSql, globalSearchWhereSql]);

  const sortColumn = sorting[0]?.id ?? null;
  const sortDesc = sorting[0]?.desc ?? false;

  const {
    data: pagedData,
    totalRows,
    isCountKnown,
    requestRange,
  } = usePagedRows({ tableName, sortColumn, sortDesc, whereSql, dataVersion });

  // RecordView用: ソート/フィルタ/テーブルが実際に変わったときだけ変わる識別キー。
  // rows配列の参照はページ到着のたびにも変わるため、position(表示中の行)のリセット判定には
  // 使えない(詳細はRecordView.tsxのコメント参照)。dataVersionを含めるのは、SQLエディタで
  // 別クエリを連続実行した場合等、tableName("_last")もsortColumn/sortDesc/whereSqlも
  // 変わらないままデータだけ読み直されるケースを区別するため。
  const queryKey = `${tableName}|${sortColumn ?? ""}|${sortDesc}|${whereSql ?? ""}|${dataVersion}`;

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
    data: pagedData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnPinningChange: setColumnPinning,
    state: {
      sorting,
      columnVisibility,
      columnOrder,
      columnPinning,
    },
  });

  const { rows } = table.getRowModel();

  // estimateSizeは初期推定値(Tailwindのp-2(8px×2)+text-smのline-height(20px)+
  // border-b(1px)からの概算、約37px)。実際の描画高さとのズレが、矢印キー移動時の
  // scrollToIndex(align: "end"、下方向)で1行分ずれて見える原因になっていたため、
  // measureElementで実測して補正する(ResizeObserverベース、可視行数にしか比例しない)。
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 37,
    overscan: 10,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - virtualRows[virtualRows.length - 1].end
      : 0;

  // 可視範囲(プリミティブ値)が変わったらサーバー側ページング化フックへプリフェッチを依頼する。
  // virtualRows配列そのものを依存に入れると毎レンダー参照が変わり発火し過ぎる。
  const visibleStartIndex = virtualRows[0]?.index ?? 0;
  const visibleEndIndex = virtualRows[virtualRows.length - 1]?.index ?? 0;
  useEffect(() => {
    if (totalRows === 0) return;
    requestRange(visibleStartIndex, visibleEndIndex);
  }, [visibleStartIndex, visibleEndIndex, totalRows, requestRange]);

  const leftHeaders = table.getLeftHeaderGroups()[0]?.headers ?? [];
  const centerHeaders = table.getCenterHeaderGroups()[0]?.headers ?? [];
  // columnOrder/columnPinning/columnVisibilityが変わらない限り参照を安定させる
  // (fetchRangeForCopy(useCallback)がorderedColumnIdsに依存しており、毎レンダー新しい配列だと
  // 参照が変わるたびにコールバックが再生成されてしまうため)。
  const { leftIds, centerIds, orderedColumnIds } = useMemo(() => {
    const leftIds = table
      .getLeftVisibleLeafColumns()
      .map((column) => column.id);
    const centerIds = table
      .getCenterVisibleLeafColumns()
      .map((column) => column.id);
    return { leftIds, centerIds, orderedColumnIds: [...leftIds, ...centerIds] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, columnPinning, columnVisibility]);
  const columnIndexById = new Map(
    orderedColumnIds.map((id, index) => [id, index]),
  );
  const isDefaultColumnOrder = schema.every(
    (col, index) => columnOrder[index] === col.columnName,
  );

  const dragState: ColumnDragState = {
    activeColumnId,
    transforms: columnTransforms,
  };

  // セル範囲選択のコピー専用。プレースホルダー配列がまだロードしていないセルを含む場合でも
  // 取りこぼさないよう、常にサーバーへ1クエリで問い合わせる(usePagedRowsのページキャッシュは
  // 経由しない)。
  const fetchRangeForCopy = useCallback(
    async (rowMin: number, rowMax: number, colMin: number, colMax: number) => {
      const colIds = orderedColumnIds.slice(colMin, colMax + 1);
      const fetchedRows = await fetchRowRange(
        tableName,
        rowMin,
        rowMax - rowMin + 1,
        sortColumn,
        sortDesc,
        whereSql,
        colIds,
      );
      return fetchedRows.map((row) => colIds.map((id) => row[id]));
    },
    [orderedColumnIds, tableName, sortColumn, sortDesc, whereSql],
  );

  const {
    selection,
    setSelection,
    handleCellMouseDown: handleCellMouseDownBase,
    handleCellMouseEnter,
    handleContainerKeyDown,
    pendingCopyConfirmation,
  } = useCellRangeSelection({
    rowCount: rows.length,
    colCount: orderedColumnIds.length,
    getColumnLabel: (colIndex) => orderedColumnIds[colIndex],
    getRowLabel: (rowIndex) => (rows[rowIndex]?.index ?? rowIndex) + 1,
    getCellValue: (rowIndex, colIndex) =>
      rows[rowIndex]?.getValue(orderedColumnIds[colIndex]),
    fetchRangeForCopy,
    onFocusMove: (pos) => rowVirtualizer.scrollToIndex(pos.rowIndex),
    includeHeaders: settings.copyIncludeHeaders,
  });

  // 行/列の並びに影響する変更が起きたら、位置(rowIndex/colIndex)で管理している選択範囲は
  // 意味を失うのでリセットする
  useEffect(() => {
    setSelection(null);
  }, [
    sorting,
    whereSql,
    columnVisibility,
    columnOrder,
    columnPinning,
    setSelection,
  ]);

  const handleCellMouseDown = (pos: CellPos, shiftKey: boolean) => {
    handleCellMouseDownBase(pos, shiftKey);
    // セル側のmousedownでpreventDefault()しているため、ブラウザ標準のフォーカス移動が
    // 起きない。矢印キー操作やCmd/Ctrl+Cコピーを受け取れるよう、コンテナへ明示的にフォーカスする。
    tableContainerRef.current?.focus();
  };

  // 行番号列+可視列すべてをまたぐ(spacer行のcolSpanに使う)
  const totalColSpan = 1 + orderedColumnIds.length;

  const renderRow = (virtualRow: VirtualItem) => {
    const row = rows[virtualRow.index];
    if (!row) return null;
    const loading = isLoadingRow(row.original);

    return (
      <TableRow
        key={row.id}
        ref={rowVirtualizer.measureElement}
        data-index={virtualRow.index}
        data-state={row.getIsSelected() && "selected"}
        className={cn("group relative z-0", loading && "opacity-40")}
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
  };

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

  if (isCountKnown && totalRows === 0) {
    return <EmptyData />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Tabs
          value={viewMode}
          onValueChange={(value) =>
            setViewMode(value as "grid" | "glimpse" | "record")
          }
        >
          <TabsList>
            <TabsTrigger value="grid">Grid</TabsTrigger>
            <TabsTrigger value="glimpse">Glimpse</TabsTrigger>
            <TabsTrigger value="record">Record</TabsTrigger>
          </TabsList>
        </Tabs>
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
          onConditionsChange={setAdvancedFilterConditions}
          onCombinatorChange={setAdvancedFilterCombinator}
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
        {(!isDefaultColumnOrder ||
          (columnPinning.left?.length ?? 0) > 0 ||
          (columnPinning.right?.length ?? 0) > 0) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setColumnOrder(schema.map((col) => col.columnName));
              setColumnPinning({ left: [], right: [] });
            }}
          >
            Reset columns
          </Button>
        )}
        <div className="flex-1" />
        <ExportActions
          onExport={(destPath) =>
            exportTableCsv(tableName, sortColumn, sortDesc, whereSql, destPath)
          }
          defaultFileName={`${tableName}.csv`}
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
      {viewMode === "grid" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragEndOrCancel}
        >
          {/*
            スクロールコンテナ(tableContainerRef)は`position: absolute; inset: 0`で
            この`relative`ラッパーいっぱいに広げる。`flex-1 min-h-0`だけに頼ると、
            ラッパー自身が(仮想化が想定通り機能しなかった場合の)子要素の実コンテンツ量に
            引きずられて高さが不定になり、ResizeObserverの測定→再レンダー→さらに高さが
            変わる、というフィードバックループに陥りうる(GlimpseView.tsxの
            横方向仮想化(L495周辺)も同じ理由で同じパターンを使っている)。
          */}
          <div className="relative min-h-0 flex-1 rounded-md border">
            <div
              ref={tableContainerRef}
              tabIndex={0}
              onKeyDown={handleContainerKeyDown}
              onBlur={() => setSelection(null)}
              className="absolute inset-0 overflow-auto outline-none"
            >
              <table className="w-full table-fixed caption-bottom text-sm">
                <TableHeader>
                  <TableRow className="relative z-0">
                    <TableHead
                      className="bg-background"
                      style={{
                        width: INDEX_COLUMN_WIDTH,
                        position: "sticky",
                        top: 0,
                        left: 0,
                        zIndex: 4,
                      }}
                    />
                    <SortableContext
                      items={leftIds}
                      strategy={horizontalListSortingStrategy}
                    >
                      {leftHeaders.map(renderHeaderCell)}
                    </SortableContext>
                    <SortableContext
                      items={centerIds}
                      strategy={horizontalListSortingStrategy}
                    >
                      {centerHeaders.map(renderHeaderCell)}
                    </SortableContext>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paddingTop > 0 && (
                    <tr aria-hidden="true">
                      <td
                        style={{ height: paddingTop, padding: 0, border: 0 }}
                        colSpan={totalColSpan}
                      />
                    </tr>
                  )}
                  {virtualRows.map(renderRow)}
                  {paddingBottom > 0 && (
                    <tr aria-hidden="true">
                      <td
                        style={{ height: paddingBottom, padding: 0, border: 0 }}
                        colSpan={totalColSpan}
                      />
                    </tr>
                  )}
                </TableBody>
              </table>
            </div>
          </div>
        </DndContext>
      ) : viewMode === "glimpse" ? (
        <GlimpseView
          rows={rows}
          orderedColumnIds={orderedColumnIds}
          schema={schema}
          table={table}
          requestRange={requestRange}
          fetchRangeForCopy={fetchRangeForCopy}
        />
      ) : (
        <RecordView
          rows={rows}
          orderedColumnIds={orderedColumnIds}
          schema={schema}
          table={table}
          requestRange={requestRange}
          queryKey={queryKey}
        />
      )}
      <LargeCopyConfirmDialog pending={pendingCopyConfirmation} />
    </div>
  );
}
