import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  Row as TanstackRow,
  Table as TanstackTable,
} from "@tanstack/react-table";
import { Row as DataRow, Schema } from "./types";
import TypeIcon from "./TypeIcon";
import TypographyTruncate from "./TypographyTruncate";
import { Button } from "@/components/ui/button";
import {
  LuArrowUp,
  LuArrowDown,
  LuArrowUpDown,
  LuGripVertical,
  LuPin,
  LuPinOff,
} from "react-icons/lu";
import { cn } from "@/lib/utils";
import {
  useCellRangeSelection,
  SELECTED_CELL_BACKGROUND,
} from "./useCellRangeSelection";
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
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

const NAME_COL_WIDTH = 200;
const TYPE_COL_WIDTH = 140;
const VALUE_CELL_WIDTH = 112;
const ROW_HEIGHT = 32;

export interface GlimpseViewProps {
  rows: TanstackRow<DataRow>[];
  orderedColumnIds: string[];
  schema: Schema;
  table: TanstackTable<DataRow>;
}

interface RowTransform {
  y: number;
  transition?: string;
}

interface RowNameCellProps {
  columnId: string;
  table: TanstackTable<DataRow>;
  onTransformChange: (id: string, transform: RowTransform | null) => void;
}

// Grid側のHeaderCellContentと同じ考え方: このカラム(Glimpseでは1行)のドラッグハンドル・
// Pin/ソートボタンを持ち、ドラッグ中の自身のtransformを親(GlimpseView)へ都度報告する。
// 値エリア側(mainScrollRefの対応する行)も同じ量だけ動かして視覚的に追従させるため。
function RowNameCell({ columnId, table, onTransformChange }: RowNameCellProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: columnId });
  const column = table.getColumn(columnId);
  const isPinned = column?.getIsPinned();
  const sortDirection = column?.getIsSorted();

  useEffect(() => {
    onTransformChange(
      columnId,
      transform ? { y: transform.y, transition } : null,
    );
  }, [columnId, transform, transition, onTransformChange]);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className="flex h-full w-full items-center gap-1 px-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-muted-foreground hover:text-foreground shrink-0 cursor-grab touch-none active:cursor-grabbing"
      >
        <LuGripVertical className="h-3.5 w-3.5" />
      </button>
      <TypographyTruncate className="flex-1 text-sm font-bold">
        {columnId}
      </TypographyTruncate>
      <Button
        size="icon"
        variant="ghost"
        className="h-4 w-4 shrink-0 cursor-pointer"
        onClick={() => column?.pin(isPinned ? false : "left")}
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
        onClick={() => column?.toggleSorting()}
      >
        {sortDirection === "asc" ? (
          <LuArrowUp className="text-foreground" />
        ) : sortDirection === "desc" ? (
          <LuArrowDown className="text-foreground" />
        ) : (
          <LuArrowUpDown className="text-foreground" />
        )}
      </Button>
    </div>
  );
}

// TableのGrid表示を転置したビュー。縦軸=カラム(通常数十~数百件で仮想化不要)、
// 横軸=フィルタ・ソート済みのデータ行(件数が大きくなりうるため横方向を仮想化する)。
// フィルタ・ソート・列の表示/非表示・並び替え・PinはTable側(呼び出し元のDataTable)の
// stateをそのまま共有しており(rows/orderedColumnIds/tableをpropsで受け取る)、
// Glimpse独自のフィルタ/ソートUIは持たない。行のD&D並び替え・Pinトグルは、共有されている
// columnOrder/columnPinning stateをtableインスタンス経由(table.setColumnOrder/setColumnPinning)で
// 直接更新することでGridの列D&D・Pinと同じ挙動にしている。
//
// 左上コーナー(Column/Type見出し)・上段(データ行番号)・左段(カラム名/型)を固定表示する必要があるが、
// position: stickyを縦横同時スクロールするコンテナに使うとWKWebView(macOS Tauri)で
// 一部の行が描画されない/固定のはずの列がスクロールしてしまう不具合が確認されたため、
// stickyには頼らず「メインの値エリア(縦横スクロール)をマスターとして、コーナー以外の
// 固定パネルはoverflow:hiddenにしてscrollLeft/scrollTopをJSで同期する」という
// 昔ながらのフリーズペイン方式で実装している。
export default function GlimpseView({
  rows,
  orderedColumnIds,
  schema,
  table,
}: GlimpseViewProps) {
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const headerRightRef = useRef<HTMLDivElement>(null);
  const leftBodyRef = useRef<HTMLDivElement>(null);
  const pinnedValueRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const columnInfoByName = new Map(schema.map((col) => [col.columnName, col]));
  // GridのPin列(sticky-left)と違い、GlimpseはPin軸(縦)がそのままスクロール軸でもあるため、
  // Pin中の行はスクロール領域の外(常時表示、スクロールしないセクション)に分けて描画する。
  const pinnedIds = table.getState().columnPinning.left ?? [];
  const pinnedIdSet = new Set(pinnedIds);
  const pinnedColumnIds = orderedColumnIds.filter((id) => pinnedIdSet.has(id));
  const unpinnedColumnIds = orderedColumnIds.filter(
    (id) => !pinnedIdSet.has(id),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [rowTransforms, setRowTransforms] = useState<
    Record<string, RowTransform | null>
  >({});

  // tanstack-virtualのuseVirtualizerもuseReactTableと同様メモ化できない関数を返す仕様のため、
  // React Compiler向けの警告が出るがこのプロジェクトはReact Compilerを導入していないため実害はない
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => mainScrollRef.current,
    estimateSize: () => VALUE_CELL_WIDTH,
    horizontal: true,
    overscan: 10,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // メインの値エリア(mainScrollRef)のスクロールに合わせて、上段(行番号ヘッダー)とPin行の値エリアは
  // 横方向、左段(カラム名/型)は縦方向の位置をJSで同期する
  const handleMainScroll = () => {
    const main = mainScrollRef.current;
    if (!main) return;
    if (headerRightRef.current) {
      headerRightRef.current.scrollLeft = main.scrollLeft;
    }
    if (pinnedValueRef.current) {
      pinnedValueRef.current.scrollLeft = main.scrollLeft;
    }
    if (leftBodyRef.current) {
      leftBodyRef.current.scrollTop = main.scrollTop;
    }
  };

  // Table.tsxのhandleTransformChangeと同じ理由(値が実際に変わった場合のみ更新しないと
  // 無限ループになる)で、参照を安定させつつ値の変化だけを見て更新する
  const handleRowTransformChange = useCallback(
    (id: string, transform: RowTransform | null) => {
      setRowTransforms((prev) => {
        const existing = prev[id] ?? null;
        const unchanged =
          existing === transform ||
          (existing !== null &&
            transform !== null &&
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

  const {
    setSelection,
    handleCellMouseDown: handleCellMouseDownBase,
    handleCellMouseEnter,
    handleContainerKeyDown,
    isCellSelected,
  } = useCellRangeSelection({
    rowCount: orderedColumnIds.length,
    colCount: rows.length,
    // Grid側の「#」列(row.index + 1)と同じ考え方で行番号を表示する。フィルタ(globalFilter等)で
    // 一部の行が除外されている場合、tanstack-table側のrow.indexには欠番が出るが、それも含めて
    // Gridの「#」列表示と一致させる(画面上のルーラーも同じ値を表示する、下記参照)。
    getColumnLabel: (colIndex) => (rows[colIndex]?.index ?? colIndex) + 1,
    getRowLabel: (rowIndex) => orderedColumnIds[rowIndex],
    getCellValue: (rowIndex, colIndex) =>
      rows[colIndex]?.getValue(orderedColumnIds[rowIndex]),
    onFocusMove: (pos) => {
      virtualizer.scrollToIndex(pos.colIndex);
      // Pin中の行は常時表示領域にあり縦スクロールしないため、追従スクロールの対象外とする
      if (pos.rowIndex >= pinnedColumnIds.length) {
        rowRefs.current[pos.rowIndex]?.scrollIntoView({ block: "nearest" });
      }
    },
  });

  const handleCellMouseDown = (
    rowIndex: number,
    colIndex: number,
    shiftKey: boolean,
  ) => {
    handleCellMouseDownBase({ rowIndex, colIndex }, shiftKey);
    mainScrollRef.current?.focus();
  };

  // Pin行(常時表示)・通常行(スクロール)どちらからも呼べるよう、1行分のName/Type・値エリアの
  // 描画をここで共通化しておく。rowIndexはorderedColumnIds全体における位置(選択範囲の座標系)。
  const renderMetaRow = (columnId: string) => {
    const columnInfo = columnInfoByName.get(columnId);
    const isActive = activeRowId === columnId;

    return (
      <div
        key={columnId}
        className="relative flex border-b last:border-b-0"
        style={{ height: ROW_HEIGHT, zIndex: isActive ? 2 : undefined }}
      >
        <div
          className={cn(isActive && "bg-background")}
          style={{ width: NAME_COL_WIDTH }}
        >
          <RowNameCell
            columnId={columnId}
            table={table}
            onTransformChange={handleRowTransformChange}
          />
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 border-r px-2",
            isActive && "bg-background",
          )}
          style={{ width: TYPE_COL_WIDTH }}
        >
          {columnInfo && (
            <TypeIcon
              dtypeGroup={columnInfo.columnDtypeGroup.type}
              fontSize="small"
            />
          )}
          <TypographyTruncate className="text-xs">
            {columnInfo?.columnType ?? ""}
          </TypographyTruncate>
        </div>
      </div>
    );
  };

  const renderValueRow = (columnId: string, rowIndex: number) => {
    const rowTransform = rowTransforms[columnId];
    const isActive = activeRowId === columnId;
    const isDisplaced = !!rowTransform && rowTransform.y !== 0;

    return (
      <div
        key={columnId}
        ref={(el) => {
          rowRefs.current[rowIndex] = el;
        }}
        className={cn(
          "relative border-b last:border-b-0",
          isActive && "bg-background",
        )}
        style={{
          height: ROW_HEIGHT,
          zIndex: isActive ? 2 : isDisplaced ? 1 : undefined,
          ...(isDisplaced
            ? {
                transform: `translateY(${rowTransform.y}px)`,
                transition: rowTransform.transition,
                opacity: isActive ? 0.6 : 1,
              }
            : {}),
        }}
      >
        {virtualItems.map((item) => {
          const colIndex = item.index;
          const value = rows[colIndex]?.getValue(columnId);
          const selected = isCellSelected({ rowIndex, colIndex });

          return (
            <div
              key={item.key}
              className="absolute top-0 flex cursor-cell items-center justify-end overflow-hidden px-2 text-sm text-ellipsis whitespace-nowrap select-none"
              style={{
                width: item.size,
                height: ROW_HEIGHT,
                transform: `translateX(${item.start}px)`,
                ...(selected
                  ? { backgroundColor: SELECTED_CELL_BACKGROUND }
                  : {}),
              }}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                handleCellMouseDown(rowIndex, colIndex, e.shiftKey);
              }}
              onMouseEnter={() => handleCellMouseEnter({ rowIndex, colIndex })}
            >
              {value === null || value === undefined ? "" : String(value)}
            </div>
          );
        })}
      </div>
    );
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveRowId(event.active.id as string);
  };

  const handleDragEndOrCancel = () => {
    setActiveRowId(null);
    setRowTransforms({});
  };

  const handleDragEnd = (event: DragEndEvent) => {
    handleDragEndOrCancel();

    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;
    const columnPinning = table.getState().columnPinning;
    const activeIsPinned = columnPinning.left?.includes(activeId) ?? false;
    const overIsPinned = columnPinning.left?.includes(overId) ?? false;

    if (activeIsPinned !== overIsPinned) {
      // Pin済み/未Pinのグループを跨ぐドロップは対象外(Pinの切り替えはPinボタンから行う、Gridと同じ)
      return;
    }

    if (activeIsPinned) {
      const left = columnPinning.left ?? [];
      const oldIndex = left.indexOf(activeId);
      const newIndex = left.indexOf(overId);
      table.setColumnPinning((prev) => ({
        ...prev,
        left: arrayMove(left, oldIndex, newIndex),
      }));
    } else {
      table.setColumnOrder((prev) => {
        const oldIndex = prev.indexOf(activeId);
        const newIndex = prev.indexOf(overId);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragEndOrCancel}
    >
      <div className="flex min-h-0 flex-1 flex-col rounded-md border">
        {/* 上段: 左上コーナー(固定) + データ行番号(横スクロールのみ、メインに同期) */}
        <div className="flex shrink-0 border-b" style={{ height: ROW_HEIGHT }}>
          <div
            className="bg-background flex shrink-0 items-center px-2 text-sm font-bold"
            style={{ width: NAME_COL_WIDTH }}
          >
            Column
          </div>
          <div
            className="bg-background flex shrink-0 items-center border-r px-2 text-sm font-bold"
            style={{ width: TYPE_COL_WIDTH }}
          >
            Type
          </div>
          <div ref={headerRightRef} className="min-w-0 flex-1 overflow-hidden">
            <div
              style={{
                position: "relative",
                width: virtualizer.getTotalSize(),
              }}
            >
              {virtualItems.map((item) => (
                <div
                  key={item.key}
                  className="text-muted-foreground absolute top-0 flex items-center justify-end px-2 text-xs"
                  style={{
                    width: item.size,
                    height: ROW_HEIGHT,
                    transform: `translateX(${item.start}px)`,
                  }}
                >
                  {(rows[item.index]?.index ?? item.index) + 1}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pin行: 縦スクロール軸=Pin軸のため、常時表示領域として分離する(下記コメント参照)
            Grid側のPin列/通常列の境界(border-r-2)と揃え、通常行との境界をborder-b-2で強調する */}
        {pinnedColumnIds.length > 0 && (
          <div className="flex shrink-0 border-b-2">
            <div
              className="shrink-0 overflow-hidden"
              style={{ width: NAME_COL_WIDTH + TYPE_COL_WIDTH }}
            >
              <SortableContext
                items={pinnedColumnIds}
                strategy={verticalListSortingStrategy}
              >
                {pinnedColumnIds.map((columnId) => renderMetaRow(columnId))}
              </SortableContext>
            </div>
            <div
              ref={pinnedValueRef}
              className="min-w-0 flex-1 overflow-hidden"
            >
              <div style={{ width: virtualizer.getTotalSize() }}>
                {pinnedColumnIds.map((columnId, i) =>
                  renderValueRow(columnId, i),
                )}
              </div>
            </div>
          </div>
        )}

        {/* 通常行: カラム名/型(縦スクロールのみ、メインに同期) + 値エリア(縦横スクロールのマスター)
            flexのmin-height:auto(コンテンツが多いと親の高さを無視して伸びてしまう)を確実に
            回避するため、flex-1ではなくabsolute inset指定で親の高さぴったりに固定する */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={leftBodyRef}
            className="absolute top-0 bottom-0 left-0 overflow-hidden"
            style={{ width: NAME_COL_WIDTH + TYPE_COL_WIDTH }}
          >
            <SortableContext
              items={unpinnedColumnIds}
              strategy={verticalListSortingStrategy}
            >
              {unpinnedColumnIds.map((columnId) => renderMetaRow(columnId))}
            </SortableContext>
          </div>
          <div
            ref={mainScrollRef}
            tabIndex={0}
            onKeyDown={handleContainerKeyDown}
            onBlur={() => setSelection(null)}
            onScroll={handleMainScroll}
            className="absolute top-0 right-0 bottom-0 overflow-auto outline-none"
            style={{ left: NAME_COL_WIDTH + TYPE_COL_WIDTH }}
          >
            {rows.length === 0 && (
              <div className="text-muted-foreground p-3 text-sm">
                No rows match the current filter.
              </div>
            )}
            <div style={{ width: virtualizer.getTotalSize() }}>
              {unpinnedColumnIds.map((columnId, i) =>
                renderValueRow(columnId, pinnedColumnIds.length + i),
              )}
            </div>
          </div>
        </div>
      </div>
    </DndContext>
  );
}
