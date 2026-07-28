import { useCallback, useEffect, useRef, useState } from "react";
import { Row } from "./types";
import { countTableRows, fetchTablePage } from "./handler";

const PAGE_SIZE = 200;
// 可視範囲の変化をデバウンスしてからフェッチする(高速スクロール中の中間状態を無視し、停止後の
// 最終的な可視範囲だけフェッチする。単一DB接続がMutexで直列化されているため、大量のin-flight
// リクエストによるhead-of-line blockingを避ける狙い。POCで実証済みの設計)。
const REQUEST_DEBOUNCE_MS = 120;

// 未ロードの行を表す共有の空オブジェクト。参照比較で「未ロード」と「実際にNULL」を区別できる
// (どちらもaccessorFn経由ではundefinedとして見えてしまうため)。
export const LOADING_ROW: Row = Object.freeze({});

export function isLoadingRow(row: Row): boolean {
  return row === LOADING_ROW;
}

export interface UsePagedRowsOptions {
  tableName: string;
  sortColumn: string | null;
  sortDesc: boolean;
  whereSql: string | null;
  // tableName/sortColumn/sortDesc/whereSqlが同じ値のまま(例: ソート/フィルタ無しの状態で
  // SQLエディタから別クエリを連続実行し、両方とも"_last"という同じテーブル名になるケース)でも、
  // データが読み直されたらキャッシュを破棄する必要があるため、呼び出し側(Table.tsx)が
  // データロードのたびに変える値を渡す。
  dataVersion: number;
}

function buildQueryKey({
  tableName,
  sortColumn,
  sortDesc,
  whereSql,
  dataVersion,
}: UsePagedRowsOptions): string {
  return `${tableName}|${sortColumn ?? ""}|${sortDesc}|${whereSql ?? ""}|${dataVersion}`;
}

// メインテーブル表示のサーバー側ページング化を担う共有フック。TanStack Tableに渡す`data`配列の
// 長さを常にtotalRows(サーバー側フィルタ後の総件数)に保ち、未ロードの行はLOADING_ROWで埋めておく。
// ロード済みの行だけ実データに差し替えることで、row.indexが常に「サーバー側ソート/フィルタ済み
// 結果内での絶対位置」と一致し、既存の仮想化・行番号表示コードをほぼ無改造で使い続けられる。
export function usePagedRows(options: UsePagedRowsOptions) {
  const { tableName, sortColumn, sortDesc, whereSql, dataVersion } = options;
  const [data, setData] = useState<Row[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  // countTableRowsが未解決の間(テーブル切り替え/ソート/フィルタ変更の直後)はfalse。
  // 呼び出し側が「まだ件数が分かっていない」と「確認済みで0件」を区別できるようにする
  // (区別しないと、ソートクリックのたびに一瞬「No rows」が表示されてしまう)。
  const [isCountKnown, setIsCountKnown] = useState(false);

  // 実際の書き込み先(ミューテーション用のワーキングバッファ)。レンダーには使わず、
  // ページロードのたびにここへ直接書き込む。確定した内容だけをdata(useState)へ反映する。
  const workingDataRef = useRef<Row[]>([]);
  const cacheRef = useRef<Map<number, Row>>(new Map());
  const loadedPagesRef = useRef<Set<number>>(new Set());
  const inFlightRef = useRef<Map<number, Promise<void>>>(new Map());
  // tableName/sortColumn/sortDesc/whereSqlが変わるたびにインクリメントする(スクロール等での
  // ページフェッチのたびにではない)。古い条件でのフェッチ応答が新しい状態を上書きしないための
  // レース対策。
  const generationRef = useRef(0);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // getCoreRowModel()はdata配列の参照が変わるたびに、可視ウィンドウの大きさに関係なく総行数分の
  // Rowラッパーを再生成する。ページ到着のたびに参照を差し替えるとこのO(N)コストを何度も払うため、
  // 参照の差し替え(setData)自体はrequestAnimationFrameで1フレームに1回にまとめる
  // (ワーキングバッファへの書き込み自体はfetchPage成功のたびに即座に行うが、確定はコアレスする)。
  const pendingSwapRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  const scheduleSwap = useCallback(() => {
    if (pendingSwapRef.current) return;
    pendingSwapRef.current = true;
    rafIdRef.current = requestAnimationFrame(() => {
      pendingSwapRef.current = false;
      rafIdRef.current = null;
      setData(workingDataRef.current.slice());
    });
  }, []);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (debounceTimeoutRef.current !== null) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const fetchPage = useCallback(
    (pageIndex: number, generation: number): Promise<void> => {
      const existing = inFlightRef.current.get(pageIndex);
      if (existing) return existing;
      if (loadedPagesRef.current.has(pageIndex)) return Promise.resolve();

      const offset = pageIndex * PAGE_SIZE;
      const promise = fetchTablePage(
        tableName,
        offset,
        PAGE_SIZE,
        sortColumn,
        sortDesc,
        whereSql,
      )
        .then((rows) => {
          if (generationRef.current !== generation) return;
          rows.forEach((row, i) => {
            const index = offset + i;
            cacheRef.current.set(index, row);
            if (index < workingDataRef.current.length) {
              workingDataRef.current[index] = row;
            }
          });
          loadedPagesRef.current.add(pageIndex);
          scheduleSwap();
        })
        .catch((err) => {
          console.error("fetchTablePage failed", err);
        })
        .finally(() => {
          inFlightRef.current.delete(pageIndex);
        });

      inFlightRef.current.set(pageIndex, promise);
      return promise;
    },
    [tableName, sortColumn, sortDesc, whereSql, scheduleSwap],
  );

  // tableName/sortColumn/sortDesc/whereSqlのいずれかが変わったら、表示中のdata/totalRowsを
  // 即座にリセットする。useEffect内でのsetState連鎖(cascading re-render)を避けるため、
  // useEffectではなくレンダー中に前回値と比較して行う(このプロジェクトの既存パターン、
  // Table.tsxのprevSchemaと同じ考え方)。キャッシュ等のrefクリア・実際のフェッチ開始は
  // 下のuseEffect側で行う。
  const queryKey = buildQueryKey(options);
  const [prevQueryKey, setPrevQueryKey] = useState(queryKey);
  if (queryKey !== prevQueryKey) {
    setPrevQueryKey(queryKey);
    setData([]);
    setTotalRows(0);
    setIsCountKnown(false);
  }

  // 上のリセットに対応する実際のフェッチ開始。generationのインクリメント・refクリアはここで行う
  // (refのミューテーションはレンダー中ではなくeffect内で行うのが安全)。setStateはcountTableRowsの
  // 解決後(非同期コールバック内)でのみ行うため、react-hooks/set-state-in-effectには抵触しない。
  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    cacheRef.current = new Map();
    loadedPagesRef.current = new Set();
    inFlightRef.current = new Map();
    workingDataRef.current = [];

    countTableRows(tableName, whereSql)
      .then((count) => {
        if (generationRef.current !== generation) return;
        workingDataRef.current = new Array(count).fill(LOADING_ROW);
        setTotalRows(count);
        setIsCountKnown(true);
        setData(workingDataRef.current);
        void fetchPage(0, generation);
      })
      .catch((err) => {
        console.error("countTableRows failed", err);
      });
  }, [tableName, sortColumn, sortDesc, whereSql, dataVersion, fetchPage]);

  // 可視範囲ベースのプリフェッチ用。呼び出し側(Grid/Glimpse/Recordの仮想化)は自身の可視範囲
  // (プリミティブ値のstart/end)が変わるたびにこれを呼ぶ。
  const requestRange = useCallback(
    (start: number, end: number) => {
      if (debounceTimeoutRef.current !== null) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        debounceTimeoutRef.current = null;
        const generation = generationRef.current;
        const total = workingDataRef.current.length;
        if (total === 0) return;
        const clampedStart = Math.max(0, start);
        const clampedEnd = Math.min(total - 1, end);
        if (clampedStart > clampedEnd) return;

        const startPage = Math.floor(clampedStart / PAGE_SIZE);
        const endPage = Math.floor(clampedEnd / PAGE_SIZE);
        for (let page = startPage; page <= endPage; page++) {
          void fetchPage(page, generation);
        }
      }, REQUEST_DEBOUNCE_MS);
    },
    [fetchPage],
  );

  return {
    data,
    totalRows,
    isCountKnown,
    requestRange,
  };
}
