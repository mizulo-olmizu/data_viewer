import { useEffect, useRef, useState } from "react";
import { NumericBin } from "./types";
import { getNumericBins } from "./handler";

// usePagedRows.tsと同じ規約(デバウンス+generationカウンタによる古い応答の破棄)を踏襲した、
// ヒストグラムモーダル用のビン再計算フック。今後の対話的チャート(2次元可視化等)も、
// パラメータ変更のたびにバックエンドへ再クエリする場合はこの形(デバウンス+generation guard+
// 初回マウント時は渡された初期値をそのまま使う)に倣う想定。
const BINS_REQUEST_DEBOUNCE_MS = 120;

export interface UseNumericBinsOptions {
  tableName: string;
  columnName: string;
  isTemporal: boolean;
  binCount: number;
  rangeMin: number;
  rangeMax: number;
}

export function useNumericBins(
  initialBins: NumericBin[],
  options: UseNumericBinsOptions,
) {
  const { tableName, columnName, isTemporal, binCount, rangeMin, rangeMax } =
    options;
  const [bins, setBins] = useState(initialBins);

  const generationRef = useRef(0);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 初回マウント時は初期表示時点で既にバックエンドが計算済みのinitialBinsをそのまま使い、
  // 同じパラメータでの無駄な再フェッチを避ける。
  const isFirstRunRef = useRef(true);

  useEffect(() => {
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      return;
    }

    generationRef.current += 1;
    const generation = generationRef.current;

    if (debounceTimeoutRef.current !== null) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      debounceTimeoutRef.current = null;
      getNumericBins(
        tableName,
        columnName,
        isTemporal,
        binCount,
        rangeMin,
        rangeMax,
      )
        .then((newBins) => {
          if (generationRef.current !== generation) return;
          setBins(newBins);
        })
        .catch((err) => {
          console.error("getNumericBins failed", err);
        });
    }, BINS_REQUEST_DEBOUNCE_MS);

    return () => {
      if (debounceTimeoutRef.current !== null) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [tableName, columnName, isTemporal, binCount, rangeMin, rangeMax]);

  return bins;
}
