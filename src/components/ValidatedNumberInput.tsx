import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface ValidatedNumberInputProps {
  value: number;
  onApply: (value: number) => void | Promise<void>;
  min?: number;
  max?: number;
  applyLabel?: string;
  inputClassName?: string;
  autoFocus?: boolean;
}

type Status =
  { kind: "idle" } | { kind: "error"; message: string } | { kind: "success" };

const SUCCESS_MESSAGE_DURATION_MS = 1500;

// 自由に入力させ、適用ボタン(またはEnter)で確定した時点でのみvalidateする数値入力欄。
// 入力の都度validateして無効値を弾く実装だと、範囲外の中間状態(例: min=1024に対する"1")を
// 経由できず文字の削除・入力自体ができなくなるため、その回避策として導入。
// 適用結果(成功/失敗)はこのフィールド直下にのみ表示する(ダイアログ全体を保存したかのような
// 誤解を避けるため、グローバルなtoast通知は使わない)。
export function ValidatedNumberInput({
  value,
  onApply,
  min,
  max,
  applyLabel = "適用",
  inputClassName,
  autoFocus,
}: ValidatedNumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // 外部から`value`が変わった(=適用が確定した)ら、レンダー中に同期して編集中の状態をリセットする。
  // (useEffect + setStateだとcascading renderになるため、Reactが推奨する描画中の同期パターンを使う)
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setDraft(String(value));
    setStatus({ kind: "idle" });
  }

  const apply = async () => {
    const parsed = Number(draft);

    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setStatus({ kind: "error", message: "数値を入力してください" });
      return;
    }
    if (min !== undefined && parsed < min) {
      setStatus({
        kind: "error",
        message: `${min}以上の値を入力してください`,
      });
      return;
    }
    if (max !== undefined && parsed > max) {
      setStatus({
        kind: "error",
        message: `${max}以下の値を入力してください`,
      });
      return;
    }

    try {
      await onApply(parsed);
      setStatus({ kind: "success" });
      window.setTimeout(() => {
        setStatus((current) =>
          current.kind === "success" ? { kind: "idle" } : current,
        );
      }, SUCCESS_MESSAGE_DURATION_MS);
    } catch (err) {
      setStatus({ kind: "error", message: `保存に失敗しました: ${err}` });
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          type="text"
          inputMode="numeric"
          className={inputClassName ?? "h-8 w-24"}
          value={draft}
          autoFocus={autoFocus}
          onChange={(e) => {
            setDraft(e.target.value);
            setStatus({ kind: "idle" });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              apply();
            } else if (e.key === "Escape") {
              setDraft(String(value));
              setStatus({ kind: "idle" });
            }
          }}
        />
        <Button size="sm" onClick={apply}>
          {applyLabel}
        </Button>
      </div>
      {status.kind === "error" && (
        <p className="text-destructive text-xs">{status.message}</p>
      )}
      {status.kind === "success" && (
        <p className="text-xs text-green-600 dark:text-green-400">
          保存しました
        </p>
      )}
    </div>
  );
}
