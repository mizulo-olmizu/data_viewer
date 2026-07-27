import { useEffect, useState } from "react";
import { errorToast } from "@/lib/errorToast";
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
    setSettings: async (settings: Settings, options?: { silent?: boolean }) => {
      // 保存に失敗してもUI上の値は既に更新済みのままにする(次回変更時に再度保存を試みる)
      setSettingsState(settings);
      try {
        await persistSettings(settings);
      } catch (err) {
        // silent指定時は、呼び出し元(ValidatedNumberInputなど)が実際のエラーを
        // 自前でインライン表示できるようにthrowするだけに留め、ここではトーストを出さない
        // (トーストとインラインエラーが同じ失敗について二重に出るのを避けるため)
        if (options?.silent) {
          throw err;
        }
        errorToast(`設定の保存に失敗しました: ${err}`);
      }
    },
  };

  return (
    <SettingsProviderContext.Provider {...props} value={value}>
      {children}
    </SettingsProviderContext.Provider>
  );
}
