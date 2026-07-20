import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { UnlistenFn } from "@tauri-apps/api/event";

export interface useDragDropProps {
  onDragStart: () => void;
  onDrop: (paths: string[]) => void;
  onDragEnd: () => void;
}

export const useDragDrop = ({
  onDragStart,
  onDrop,
  onDragEnd,
}: useDragDropProps) => {
  // イベントリスナーはマウント時に一度だけ登録するため、常に最新のコールバックを参照できるようrefに保持する
  const callbacksRef = useRef({ onDragStart, onDrop, onDragEnd });
  useEffect(() => {
    callbacksRef.current = { onDragStart, onDrop, onDragEnd };
  }, [onDragStart, onDrop, onDragEnd]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          callbacksRef.current.onDragStart();
        } else if (event.payload.type === "drop") {
          callbacksRef.current.onDragEnd();
          callbacksRef.current.onDrop(event.payload.paths);
        } else {
          callbacksRef.current.onDragEnd();
        }
      });
    })();

    return () => {
      if (unlisten != null) {
        unlisten();
      }
    };
  }, []);

  return;
};
