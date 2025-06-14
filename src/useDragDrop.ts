import { useEffect } from "react";
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
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          onDragStart();
        } else if (event.payload.type === "drop") {
          onDragEnd();
          onDrop(event.payload.paths);
        } else {
          onDragEnd();
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
