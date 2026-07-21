import { useCallback, useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
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

interface UseCellRangeSelectionOptions {
  rowCount: number;
  colCount: number;
  // コピー時にTSVの先頭行へ差し込む列ラベル(Table: 列名、Glimpse: 行番号)
  getColumnLabel: (colIndex: number) => string | number;
  // コピー時に各行の先頭へ差し込む行ラベル(Table: 行番号、Glimpse: カラム名)
  getRowLabel: (rowIndex: number) => string | number;
  getCellValue: (rowIndex: number, colIndex: number) => unknown;
  // 矢印キーでの移動後にフォーカスが画面外に出ないよう、呼び出し側でスクロール追従させるためのフック
  onFocusMove?: (pos: CellPos) => void;
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
  onFocusMove,
}: UseCellRangeSelectionOptions) {
  const [selection, setSelection] = useState<CellSelection | null>(null);
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
    const colMin = Math.min(
      selection.anchor.colIndex,
      selection.focus.colIndex,
    );
    const colMax = Math.max(
      selection.anchor.colIndex,
      selection.focus.colIndex,
    );

    // 選択範囲自体は行ラベル・列ラベルを含まないが、貼り付け先で何のデータか
    // 分かるよう、コピー時は先頭行に列ラベル、各行の先頭に行ラベルを付与する
    const headerRow = ["", ...range(colMin, colMax).map(getColumnLabel)];
    const dataRows = range(rowMin, rowMax).map((rowIndex) => [
      getRowLabel(rowIndex),
      ...range(colMin, colMax).map((colIndex) =>
        getCellValue(rowIndex, colIndex),
      ),
    ]);

    writeText(toTsv([headerRow, ...dataRows]))
      .then(() => toast("コピーしました"))
      .catch((err) => toast.error(`コピーに失敗しました: ${err}`));
  }, [selection, getColumnLabel, getRowLabel, getCellValue]);

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
  };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
