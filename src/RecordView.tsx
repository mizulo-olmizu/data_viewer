import { useEffect, useMemo, useState } from "react";
import type {
  Row as TanstackRow,
  Table as TanstackTable,
} from "@tanstack/react-table";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { errorToast } from "@/lib/errorToast";
import { ColumnInfo, Row as DataRow, Schema } from "./types";
import TypeIcon from "./TypeIcon";
import TypographyTruncate from "./TypographyTruncate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  LuChevronLeft,
  LuChevronRight,
  LuShuffle,
  LuCopy,
  LuGripVertical,
} from "react-icons/lu";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { isLoadingRow } from "./usePagedRows";

export interface RecordViewProps {
  rows: TanstackRow<DataRow>[];
  orderedColumnIds: string[];
  schema: Schema;
  table: TanstackTable<DataRow>;
  // 表示中の1行(絶対位置)ベースのプリフェッチ依頼(サーバー側ページング化用)
  requestRange: (start: number, end: number) => void;
  // ソート/フィルタ/テーブルの識別キー(tableName+sortColumn+sortDesc+whereSqlを連結したもの)。
  // サーバー側ページング化により、データロード中(ページ到着のたび)にもrows配列の参照が
  // 変わるため、rows参照の変化ではなくこのキーの変化でposition(表示中の行)をリセットする。
  queryKey: string;
}

function isPrimitive(value: unknown) {
  return (
    value === null || (typeof value !== "object" && typeof value !== "function")
  );
}

// nested(構造体/配列/マップ)型のみJSON.stringify(value, null, 2)でpretty-printする。
// それ以外はString()でそのまま表示する(数値のロケール変換等はしない、生の値を見せる方針)。
function formatValueForDisplay(value: unknown, isNested: boolean) {
  if (value === null || value === undefined) {
    return { text: "", isNull: true };
  }
  if (isNested && !isPrimitive(value)) {
    return { text: JSON.stringify(value, null, 2), isNull: false };
  }
  return { text: String(value), isNull: false };
}

function formatValueForCopy(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (isPrimitive(value)) {
    return String(value);
  }
  return JSON.stringify(value);
}

interface FieldCardProps {
  columnId: string;
  columnInfo?: ColumnInfo;
  value: unknown;
  loading: boolean;
}

// 1フィールド分のカード。ドラッグハンドルで並び替え(共有columnOrder/columnPinningを更新)、
// コピーアイコンで値をそのままクリップボードへコピーできる。値は(Grid/Glimpseと違い)幅の制約が
// ないため切り詰めず、nested(struct/list/map)型のみJSON.stringifyでpretty-printする。
function FieldCard({ columnId, columnInfo, value, loading }: FieldCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: columnId });
  const isNested = columnInfo?.columnDtypeGroup.type === "nested";
  const { text, isNull } = formatValueForDisplay(value, isNested);
  // columnType(ColumnInfo.columnType)はTS上string型だが、実際はDuckDBType enumがserdeの
  // デフォルト(外部タグ形式)でそのままJSON化されたもので、STRUCT/LIST/MAP等はオブジェクト
  // (例: {"Struct": [...]})になる。Table.tsx/GlimpseViewと同じくJSON.stringifyで文字列化してから表示する。
  const columnTypeText = formatValueForCopy(columnInfo?.columnType);

  const handleCopy = () => {
    writeText(formatValueForCopy(value))
      .then(() => toast("コピーしました"))
      .catch((err) => errorToast(`コピーに失敗しました: ${err}`));
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className="bg-card flex flex-col gap-1 rounded-md border p-2"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="text-muted-foreground hover:text-foreground shrink-0 cursor-grab touch-none active:cursor-grabbing"
        >
          <LuGripVertical className="h-3.5 w-3.5" />
        </button>
        {columnInfo && (
          <TypeIcon
            dtypeGroup={columnInfo.columnDtypeGroup.type}
            fontSize="small"
          />
        )}
        <TypographyTruncate className="flex-1 text-xs font-bold">
          {columnId}
        </TypographyTruncate>
        <TypographyTruncate className="text-muted-foreground max-w-20 shrink-0 text-xs">
          {columnTypeText}
        </TypographyTruncate>
        <Button
          size="icon"
          variant="ghost"
          className="h-4 w-4 shrink-0 cursor-pointer"
          disabled={isNull || loading}
          onClick={handleCopy}
        >
          <LuCopy className="text-foreground" />
        </Button>
      </div>
      <div className="max-h-56 overflow-y-auto text-sm">
        {loading ? (
          <Badge variant="outline" className="text-muted-foreground">
            Loading…
          </Badge>
        ) : isNull ? (
          <Badge variant="outline" className="text-muted-foreground">
            NULL
          </Badge>
        ) : isNested ? (
          <pre className="font-mono text-xs break-all whitespace-pre-wrap">
            {text}
          </pre>
        ) : (
          <span className="break-all whitespace-pre-wrap">{text}</span>
        )}
      </div>
    </div>
  );
}

// Rのglimpse()的なTable/Glimpseの転置ビューとは別に、1レコードを画面いっぱいのカード群として
// 表示するビュー。Grid/Glimpseと同じくフィルタ・ソート・列の表示/非表示・並び替え・PinはTable側
// (呼び出し元のDataTable)のstateをそのまま共有する(rows/orderedColumnIds/tableをpropsで受け取る)。
// Pin/Sortの専用ボタンはここでは持たない(1レコードしか見えないため意味を持たない、という判断)が、
// 既存のPin状態自体はorderedColumnIdsの並び(Pin列が先頭)にそのまま反映され、カードの並び替えも
// Pin/非Pinのグループを跨がないようにしている(Grid/Glimpseと同じ制約)。
export default function RecordView({
  rows,
  orderedColumnIds,
  schema,
  table,
  requestRange,
  queryKey,
}: RecordViewProps) {
  const [position, setPosition] = useState(0);
  const [jumpInvalid, setJumpInvalid] = useState(false);
  // queryKey(tableName+sortColumn+sortDesc+whereSql)が変わった=表示される行の集合/順序が
  // 変わったときは、position(絶対行インデックス)の意味も失われるので0に戻す。rows配列の参照は
  // サーバー側ページング化によりページ到着のたびにも変わるため、reset判定には使えない
  // (queryKeyはソート/フィルタ/テーブルが実際に変わったときだけ変わる)。useEffectではなく
  // レンダー中に前回値と比較して更新する(このプロジェクトで既に使われているパターン、Table.tsxの
  // prevSchemaと同じ考え方)。
  const [prevQueryKey, setPrevQueryKey] = useState(queryKey);
  if (queryKey !== prevQueryKey) {
    setPrevQueryKey(queryKey);
    setPosition(0);
    setJumpInvalid(false);
  }

  const columnInfoByName = useMemo(
    () => new Map(schema.map((col) => [col.columnName, col])),
    [schema],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const clampedPosition =
    rows.length === 0 ? 0 : Math.min(Math.max(position, 0), rows.length - 1);
  const currentRow = rows[clampedPosition];
  const currentRowNumber = (currentRow?.index ?? 0) + 1;
  const currentRowLoading = currentRow
    ? isLoadingRow(currentRow.original)
    : false;

  // 表示中の1行が確実にロードされるよう依頼する(Grid/Glimpseと同じ120msデバウンス付きの
  // requestRangeを使うため、Prev/Next連打やスライダードラッグで位置が高頻度に変わっても
  // 都度即時フェッチしない)。
  useEffect(() => {
    if (rows.length === 0) return;
    requestRange(clampedPosition, clampedPosition);
  }, [clampedPosition, rows.length, requestRange]);

  const goTo = (index: number) => {
    if (rows.length === 0) return;
    setPosition(Math.min(Math.max(index, 0), rows.length - 1));
    // Prev/Next・スライダー・ランダムなど、行番号入力欄以外の操作で移動した場合も
    // 赤枠(invalid表示)を解除する(表示中の行が変わった時点でエラー状態を引きずらない)
    setJumpInvalid(false);
  };
  const goPrev = () => goTo(clampedPosition - 1);
  const goNext = () => goTo(clampedPosition + 1);
  const goRandom = () => {
    if (rows.length <= 1) return;
    // 必ず現在とは別のレコードに移動する(同じ乱数を引いた場合は1つずらす)
    const index = Math.floor(Math.random() * rows.length);
    goTo(index === clampedPosition ? (index + 1) % rows.length : index);
  };

  // サーバー側ページング化により、row.indexは常に「サーバー側ソート/フィルタ済み結果内での
  // 絶対位置」と一致する(欠番が出ない)ため、行番号(1-indexed)→position(0-indexed)は
  // 単純な引き算だけで済む(以前のような逆引きMapは不要)。
  const jumpToRowNumber = (raw: string) => {
    const trimmed = raw.trim();
    const n = Number(trimmed);
    if (trimmed === "" || !Number.isInteger(n)) {
      setJumpInvalid(true);
      errorToast("有効な行番号を入力してください");
      return;
    }
    const index = n - 1;
    if (index < 0 || index >= rows.length) {
      setJumpInvalid(true);
      errorToast(`行番号 ${n} は現在の表示に含まれていません`);
      return;
    }
    setJumpInvalid(false);
    goTo(index);
  };

  // Prev/Next(←/→、vimライクなk/j)のキー操作。テキスト入力やスライダーにフォーカスがある間は
  // ブラウザ標準の挙動(カーソル移動、スライダーの値変更)を優先するため対象外にする。
  const handleContainerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.closest('[role="slider"]')) {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    const key = e.key.toLowerCase();
    if (e.key === "ArrowLeft" || key === "k") {
      e.preventDefault();
      goPrev();
    } else if (e.key === "ArrowRight" || key === "j") {
      e.preventDefault();
      goNext();
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
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
      // Pin済み/未Pinのグループを跨ぐドロップは対象外(Grid/Glimpseと同じ制約)
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

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center rounded-md border text-sm">
        No rows match the current filter.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={clampedPosition === 0}
          onClick={goPrev}
        >
          <LuChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={clampedPosition === rows.length - 1}
          onClick={goNext}
        >
          <LuChevronRight />
        </Button>
        <span
          className="text-muted-foreground inline-block shrink-0 overflow-hidden text-right font-mono text-sm text-nowrap tabular-nums"
          // rows.lengthの桁数を基準に幅を固定し、位置が動くたびに桁数が変わって
          // 右側のUI(スライダー・ランダムボタン等)がガタガタ動くのを防ぐ。position<=rows.lengthより
          // 分子の桁数は分母を超えない(=はみ出さない)計算だが、念のためoverflow-hidden/text-nowrapで
          // 万一はみ出しても隣の要素を押し出さず切り詰められるようにしておく
          style={{ width: `${String(rows.length).length * 2 + 3}ch` }}
        >
          {clampedPosition + 1} / {rows.length}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-xs">Row #</span>
          <Input
            key={currentRowNumber}
            defaultValue={String(currentRowNumber)}
            aria-invalid={jumpInvalid}
            className="h-8 w-20"
            onChange={() => setJumpInvalid(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                jumpToRowNumber(e.currentTarget.value);
              }
            }}
            onBlur={(e) => jumpToRowNumber(e.currentTarget.value)}
          />
        </div>
        <Slider
          className="w-40"
          min={0}
          max={Math.max(rows.length - 1, 0)}
          step={1}
          value={[clampedPosition]}
          disabled={rows.length <= 1}
          onValueChange={([value]) => goTo(value)}
        />
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={rows.length <= 1}
          onClick={goRandom}
          title="Jump to random record"
        >
          <LuShuffle />
        </Button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div
          tabIndex={0}
          onKeyDown={handleContainerKeyDown}
          className="min-h-0 flex-1 overflow-y-auto rounded-md border p-3 outline-none"
        >
          <SortableContext
            items={orderedColumnIds}
            strategy={rectSortingStrategy}
          >
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              }}
            >
              {orderedColumnIds.map((columnId) => (
                <FieldCard
                  key={columnId}
                  columnId={columnId}
                  columnInfo={columnInfoByName.get(columnId)}
                  value={currentRow?.original[columnId]}
                  loading={currentRowLoading}
                />
              ))}
            </div>
          </SortableContext>
        </div>
      </DndContext>
    </div>
  );
}
