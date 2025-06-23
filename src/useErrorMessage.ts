import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { UnlistenFn } from "@tauri-apps/api/event";

export const useErrorMessage = () => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      unlisten = await listen("error", async (event) => {
        console.error(event);
        if (typeof event.payload === "string") {
          setErrorMessage(event.payload);
        }
      });
    })();

    return () => {
      if (unlisten != null) {
        unlisten();
      }
    };
  }, []);

  return [errorMessage, setErrorMessage] as const;
};
