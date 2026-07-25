import { useEffect, useState } from "react";
import {
  Settings,
  SettingsProviderContext,
  defaultSettings,
} from "@/hooks/use-settings";
import { getSettings, setSettings as persistSettings } from "@/handler";

type SettingsProviderProps = {
  children: React.ReactNode;
};

export function SettingsProvider({
  children,
  ...props
}: SettingsProviderProps) {
  const [settings, setSettingsState] = useState<Settings | null>(null);

  useEffect(() => {
    getSettings()
      .then((stored) => setSettingsState({ ...defaultSettings, ...stored }))
      .catch(() => setSettingsState(defaultSettings));
  }, []);

  useEffect(() => {
    if (!settings) {
      return;
    }

    const root = window.document.documentElement;
    root.classList.remove("light", "dark");

    if (settings.theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(settings.theme);
  }, [settings]);

  // 初回ロード完了までは(テーマのちらつきを避けるため)何も描画しない
  if (!settings) {
    return null;
  }

  const value = {
    settings,
    setSettings: (settings: Settings) => {
      setSettingsState(settings);
      persistSettings(settings).catch(() => {
        // 保存に失敗してもUI上の値は既に更新済みのままにする(次回変更時に再度保存を試みる)
      });
    },
  };

  return (
    <SettingsProviderContext.Provider {...props} value={value}>
      {children}
    </SettingsProviderContext.Provider>
  );
}
