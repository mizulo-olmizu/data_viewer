import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { extractTablePage } from "./handler";
import { Row, Schema } from "./types";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DebouncedInput from "@/components/DebouncedInput";
import TypographyTruncate from "./TypographyTruncate";
import { LuArrowUp, LuArrowDown, LuArrowUpDown } from "react-icons/lu";

// サーバー側ページング化の技術検証(POC)用の最小実装。D&D列並び替え・Pin・セル範囲選択・
// CSVエクスポートは対象外(docs/design/performance.mdの「サーバー側ページング化の再検討」参照)。
const PAGE_SIZE = 200;
// 高速スクロール中の中間可視範囲でフェッチしない(単一DB接続がMutexで直列化されているため、
// 大量のin-flightリクエストによるhead-of-line blockingを避ける狙い)。
const FETCH_DEBOUNCE_MS = 120;
const INDEX_COLUMN_WIDTH = 56;
// table-fixedのもとでは列側にも明示的な幅指定が要る(無いとheader/bodyの列幅がずれて
// 崩れる)。Table.tsxのようなユーザー操作によるリサイズはPOCでは実装しない。
const DATA_COLUMN_WIDTH = 160;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

interface PagedGridPocProps {
  tableName: string;
  schema: Schema;
}

export default function PagedGridPoc({ tableName, schema }: PagedGridPocProps) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const [whereSql, setWhereSql] = useState("");
  const [totalRows, setTotalRows] = useState(0);
  const [, forceRender] = useReducer((c: number) => c + 1, 0);

  const containerRef = useRef<HTMLDivElement>(null);
  // キャッシュはMapで直接ミューテートし、forceRenderで再描画をトリガーする
  // (絶対行インデックス→行データ)。
  const cacheRef = useRef<Map<number, Row>>(new Map());
  const loadedPagesRef = useRef<Set<number>>(new Set());
  const inFlightPagesRef = useRef<Set<number>>(new Set());
  // ソート/フィルタ/テーブル切り替えのたびにインクリメントする(ページフェッチのたびにではない、
  // 同一条件下での並行フェッチは正常であり誤って捨てるとキャッシュが埋まらなくなるため)。
  const generationRef = useRef(0);

  const whereArg = whereSql.trim() === "" ? null : whereSql;

  // ソート/フィルタ/テーブルが変わったらキャッシュを全クリアし、総件数と先頭ページを取り直す
  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    cacheRef.current = new Map();
    loadedPagesRef.current = new Set();
    inFlightPagesRef.current = new Set();
    setTotalRows(0);
    forceRender();

    // 可視範囲監視のfetchPageと0ページを取り合わないよう、先にin-flight登録しておく
    inFlightPagesRef.current.add(0);
    extractTablePage(tableName, 0, PAGE_SIZE, sortColumn, sortDesc, whereArg)
      .then((result) => {
        inFlightPagesRef.current.delete(0);
        if (generationRef.current !== generation) return;
        result.df.forEach((row, i) => cacheRef.current.set(i, row));
        loadedPagesRef.current.add(0);
        setTotalRows(result.totalRows);
      })
      .catch((err) => {
        inFlightPagesRef.current.delete(0);
        console.error("extractTablePage failed", err);
      });
  }, [tableName, sortColumn, sortDesc, whereArg]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 37,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const startIndex = virtualItems[0]?.index ?? 0;
  const endIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;

  const fetchPage = useCallback(
    (pageIndex: number, generation: number) => {
      if (
        loadedPagesRef.current.has(pageIndex) ||
        inFlightPagesRef.current.has(pageIndex)
      ) {
        return;
      }
      inFlightPagesRef.current.add(pageIndex);
      const offset = pageIndex * PAGE_SIZE;

      extractTablePage(
        tableName,
        offset,
        PAGE_SIZE,
        sortColumn,
        sortDesc,
        whereArg,
      )
        .then((result) => {
          inFlightPagesRef.current.delete(pageIndex);
          if (generationRef.current !== generation) return;
          result.df.forEach((row, i) => cacheRef.current.set(offset + i, row));
          loadedPagesRef.current.add(pageIndex);
          forceRender();
        })
        .catch((err) => {
          inFlightPagesRef.current.delete(pageIndex);
          console.error("extractTablePage failed", err);
        });
    },
    [tableName, sortColumn, sortDesc, whereArg],
  );

  // 可視範囲(startIndex/endIndex、プリミティブ値)が変わったらデバウンスしてフェッチする。
  // virtualItems配列そのものを依存に入れると毎レンダー参照が変わり発火し過ぎる。
  useEffect(() => {
    if (totalRows === 0) return;
    const generation = generationRef.current;
    const timeout = setTimeout(() => {
      const startPage = Math.floor(startIndex / PAGE_SIZE);
      const endPage = Math.floor(endIndex / PAGE_SIZE);
      for (let page = startPage; page <= endPage; page++) {
        fetchPage(page, generation);
      }
    }, FETCH_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [startIndex, endIndex, totalRows, fetchPage]);

  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;
  const totalColSpan = 1 + schema.length;

  const toggleSort = (columnName: string) => {
    if (sortColumn !== columnName) {
      setSortColumn(columnName);
      setSortDesc(false);
    } else if (!sortDesc) {
      setSortDesc(true);
    } else {
      setSortColumn(null);
      setSortDesc(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <DebouncedInput
          value={whereSql}
          onChange={setWhereSql}
          debounce={500}
          placeholder="WHERE句を直接入力(例: total_amount > 100)"
          className="h-8 flex-1"
        />
        <span className="text-muted-foreground shrink-0 text-xs">
          {totalRows.toLocaleString()} rows
        </span>
      </div>
      <div className="relative min-h-0 flex-1 rounded-md border">
        <div ref={containerRef} className="absolute inset-0 overflow-auto">
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
                {schema.map((col) => (
                  <TableHead
                    key={col.columnName}
                    className="bg-background"
                    style={{
                      width: DATA_COLUMN_WIDTH,
                      position: "sticky",
                      top: 0,
                      zIndex: 3,
                    }}
                  >
                    <button
                      type="button"
                      className="flex w-full min-w-0 cursor-pointer items-center justify-end gap-1"
                      onClick={() => toggleSort(col.columnName)}
                    >
                      <TypographyTruncate className="min-w-0 flex-1 font-bold">
                        {col.columnName}
                      </TypographyTruncate>
                      {sortColumn === col.columnName ? (
                        sortDesc ? (
                          <LuArrowDown className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <LuArrowUp className="h-3.5 w-3.5 shrink-0" />
                        )
                      ) : (
                        <LuArrowUpDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                      )}
                    </button>
                  </TableHead>
                ))}
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
              {virtualItems.map((virtualRow) => {
                const row = cacheRef.current.get(virtualRow.index);
                return (
                  <TableRow
                    key={virtualRow.index}
                    data-index={virtualRow.index}
                  >
                    <TableCell
                      className="bg-background text-end"
                      style={{ width: INDEX_COLUMN_WIDTH }}
                    >
                      {virtualRow.index + 1}
                    </TableCell>
                    {schema.map((col) => (
                      <TableCell
                        key={col.columnName}
                        className="truncate text-end"
                        style={{ width: DATA_COLUMN_WIDTH }}
                      >
                        {row ? formatCell(row[col.columnName]) : "…"}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
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
    </div>
  );
}
