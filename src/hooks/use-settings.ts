import { createContext, useContext } from "react";

export type Theme = "dark" | "light" | "system";

export type InferSchemaLengthSetting =
  { kind: "default" } | { kind: "inf" } | { kind: "custom"; value: number };

export type Settings = {
  theme: Theme;
  inferSchemaLength: InferSchemaLengthSetting;
  limitDialogThreshold: number;
  copyIncludeHeaders: boolean;
  focusOnExternalUpdate: boolean;
  httpPort: number;
};

export const defaultSettings: Settings = {
  theme: "system",
  inferSchemaLength: { kind: "default" },
  limitDialogThreshold: 1_000_000,
  copyIncludeHeaders: true,
  focusOnExternalUpdate: true,
  httpPort: 3000,
};

export type SettingsProviderState = {
  settings: Settings;
  // 永続化(settings.json書き込み)に成功したかどうかをboolean(常にresolveする)で返す。
  // 呼び出し側は成功時だけ独自のフィードバック(トーストなど)を出せる。失敗時のエラー通知自体は
  // SettingsProvider側で一元的に行うため、呼び出し側での個別ハンドリングは必須ではない。
  setSettings: (settings: Settings) => Promise<boolean>;
};

const initialState: SettingsProviderState = {
  settings: defaultSettings,
  setSettings: () => Promise.resolve(false),
};

export const SettingsProviderContext =
  createContext<SettingsProviderState>(initialState);

export const useSettings = () => {
  const context = useContext(SettingsProviderContext);

  if (context === undefined)
    throw new Error("useSettings must be used within a SettingsProvider");

  return context;
};
