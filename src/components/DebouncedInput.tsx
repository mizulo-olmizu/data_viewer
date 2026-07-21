import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export default function DebouncedInput({
  value: externalValue,
  onChange,
  debounce = 300,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  debounce?: number;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  const [value, setValue] = useState(externalValue);
  const [prevExternalValue, setPrevExternalValue] = useState(externalValue);

  if (externalValue !== prevExternalValue) {
    setPrevExternalValue(externalValue);
    setValue(externalValue);
  }

  // onChangeは呼び出し側で毎レンダー新しい関数になりうる(例: カラムごとのフィルタ)。
  // 依存配列にonChangeそのものを入れると、onChangeの参照が変わるたびにタイマーが再セットされ、
  // 「setFilterValue→再レンダー→onChange再生成→タイマー再セット」の無限ループになるため、
  // refで最新のonChangeを参照しつつ、effectの再実行はvalue/debounceの変化のみに限定する。
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const timeout = setTimeout(() => {
      onChangeRef.current(value);
    }, debounce);

    return () => clearTimeout(timeout);
  }, [value, debounce]);

  return (
    <Input
      {...props}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
