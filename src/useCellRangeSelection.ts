import { useCallback, useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { errorToast } from "@/lib/errorToast";
import { toTsv } from "./csv";

// Grid(Table.tsx)とGlimpse(GlimpseView.tsx)で選択中セルのハイライトを揃えるための共通値
export const SELECTED_CELL_BACKGROUND =
  "color-mix(in oklch, var(--primary) 18%, var(--background) 82%)";

export interface CellPos {
  rowIndex: number;
  colIndex: number;
}

export interface CellSelection {
  anchor: CellPos;
  focus: CellPos;
}

export function isCellSelected(selection: CellSelection | null, pos: CellPos) {
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

// コピー対象の行数がこれを超える場合、fetchRangeForCopyでの取得前に確認を挟む
// (単一DB接続がMutexで直列化されているため、大量選択のコピーはページ数分の往復が発生し
// 体感的に固まって見えるリスクがある。選択方法(ドラッグ/Shift+矢印キー/Cmd+A等)を問わず、
// 選択範囲の行数だけで判定する)。
const LARGE_COPY_ROW_THRESHOLD = 50_000;

export interface PendingCopyConfirmation {
  rowCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

interface UseCellRangeSelectionOptions {
  rowCount: number;
  colCount: number;
  // コピー時にTSVの先頭行へ差し込む列ラベル(Table: 列名、Glimpse: 行番号)
  getColumnLabel: (colIndex: number) => string | number;
  // コピー時に各行の先頭へ差し込む行ラベル(Table: 行番号、Glimpse: カラム名)
  getRowLabel: (rowIndex: number) => string | number;
  getCellValue: (rowIndex: number, colIndex: number) => unknown;
  // 渡された場合、コピー時は常にこれで選択範囲の値を1クエリで取得する(getCellValueには
  // フォールバックしない。プレースホルダー配列がまだロードしていないセルを含む場合でも
  // 取りこぼさないため)。戻り値は[rowMin..rowMax] x [colMin..colMax]の行×列の値の配列。
  fetchRangeForCopy?: (
    rowMin: number,
    rowMax: number,
    colMin: number,
    colMax: number,
  ) => Promise<unknown[][]>;
  // 矢印キーでの移動後にフォーカスが画面外に出ないよう、呼び出し側でスクロール追従させるためのフック
  onFocusMove?: (pos: CellPos) => void;
  // コピー時に列ラベル/行ラベルを付与するか(設定画面のトグルから渡される)
  includeHeaders: boolean;
}

// Excel/Google Sheetsのようなセル範囲選択(ドラッグ、Shift+クリック、矢印キー/Shift+矢印キー)+
// Cmd/Ctrl+Cでのコピーを、行/列の意味付け(データ行×カラム、またはその転置)を問わず扱えるようにした汎用フック。
// 元は src/Table.tsx にベタ書きされていたロジックを抽出したもの。
export function useCellRangeSelection({
  rowCount,
  colCount,
  getColumnLabel,
  getRowLabel,
  getCellValue,
  fetchRangeForCopy,
  onFocusMove,
  includeHeaders,
}: UseCellRangeSelectionOptions) {
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const [pendingCopyConfirmation, setPendingCopyConfirmation] =
    useState<PendingCopyConfirmation | null>(null);
  const isSelectingRef = useRef(false);

  // ドラッグ選択中にセルの外でマウスボタンを離した場合も選択を確定させる
  useEffect(() => {
    const handleMouseUp = () => {
      isSelectingRef.current = false;
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const handleCellMouseDown = useCallback((pos: CellPos, shiftKey: boolean) => {
    isSelectingRef.current = true;
    setSelection((prev) =>
      shiftKey && prev
        ? { anchor: prev.anchor, focus: pos }
        : { anchor: pos, focus: pos },
    );
  }, []);

  const handleCellMouseEnter = useCallback((pos: CellPos) => {
    if (!isSelectingRef.current) return;
    setSelection((prev) =>
      prev ? { anchor: prev.anchor, focus: pos } : { anchor: pos, focus: pos },
    );
  }, []);

  const performCopy = useCallback(
    async (selection: CellSelection) => {
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

      try {
        const cellsByRow = fetchRangeForCopy
          ? await fetchRangeForCopy(rowMin, rowMax, colMin, colMax)
          : range(rowMin, rowMax).map((rowIndex) =>
              range(colMin, colMax).map((colIndex) =>
                getCellValue(rowIndex, colIndex),
              ),
            );

        // 選択範囲自体は行ラベル・列ラベルを含まないが、貼り付け先で何のデータか
        // 分かるよう、設定でオンの場合は先頭行に列ラベル、各行の先頭に行ラベルを付与する
        const dataRows = cellsByRow.map((cells, i) => {
          const rowIndex = rowMin + i;
          return includeHeaders ? [getRowLabel(rowIndex), ...cells] : cells;
        });
        const rows = includeHeaders
          ? [["", ...range(colMin, colMax).map(getColumnLabel)], ...dataRows]
          : dataRows;

        await writeText(toTsv(rows));
        toast("コピーしました");
      } catch (err) {
        errorToast(`コピーに失敗しました: ${err}`);
      }
    },
    [
      fetchRangeForCopy,
      getCellValue,
      getColumnLabel,
      getRowLabel,
      includeHeaders,
    ],
  );

  const copySelection = useCallback(() => {
    if (!selection) return;

    const rowMin = Math.min(
      selection.anchor.rowIndex,
      selection.focus.rowIndex,
    );
    const rowMax = Math.max(
      selection.anchor.rowIndex,
      selection.focus.rowIndex,
    );
    const rowCount = rowMax - rowMin + 1;

    if (fetchRangeForCopy && rowCount > LARGE_COPY_ROW_THRESHOLD) {
      setPendingCopyConfirmation({
        rowCount,
        onConfirm: () => {
          setPendingCopyConfirmation(null);
          void performCopy(selection);
        },
        onCancel: () => setPendingCopyConfirmation(null),
      });
      return;
    }

    void performCopy(selection);
  }, [selection, fetchRangeForCopy, performCopy]);

  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
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
            focus: { rowIndex: rowCount - 1, colIndex: colCount - 1 },
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
      const clamp = (value: number, max: number) =>
        Math.min(Math.max(value, 0), max);
      const newFocus: CellPos = {
        rowIndex: clamp(selection.focus.rowIndex + delta[0], rowCount - 1),
        colIndex: clamp(selection.focus.colIndex + delta[1], colCount - 1),
      };

      setSelection({
        anchor: e.shiftKey ? selection.anchor : newFocus,
        focus: newFocus,
      });
      onFocusMove?.(newFocus);
    },
    [selection, rowCount, colCount, copySelection, onFocusMove],
  );

  return {
    selection,
    setSelection,
    handleCellMouseDown,
    handleCellMouseEnter,
    handleContainerKeyDown,
    isCellSelected: (pos: CellPos) => isCellSelected(selection, pos),
    pendingCopyConfirmation,
  };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
