import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { UnlistenFn } from "@tauri-apps/api/event";

export const useMode = () => {
  const [mode, setMode] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      setMode(await getCurrentWindow().theme());

      unlisten = await getCurrentWindow().onThemeChanged(
        ({ payload: mode }) => {
          console.log(`mode changed to ${mode}`);
          setMode(mode);
        },
      );
    })();

    return () => {
      if (unlisten != null) {
        unlisten();
      }
    };
  }, []);

  return mode ?? "light";
};
