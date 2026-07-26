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
  // デフォルトでは失敗時にSettingsProvider側でトースト表示まで行い、例外は投げずに
  // 常にresolveする(呼び出し元で個別ハンドリングしなくても安全なfire-and-forgetで使える)。
  // { silent: true }を指定すると、トーストを出さずに失敗時はthrowするだけになる
  // (呼び出し元がValidatedNumberInputのようにインラインで実際のエラーを表示したい場合用)。
  setSettings: (
    settings: Settings,
    options?: { silent?: boolean },
  ) => Promise<void>;
};

const initialState: SettingsProviderState = {
  settings: defaultSettings,
  setSettings: () => Promise.resolve(),
};

export const SettingsProviderContext =
  createContext<SettingsProviderState>(initialState);

export const useSettings = () => {
  const context = useContext(SettingsProviderContext);

  if (context === undefined)
    throw new Error("useSettings must be used within a SettingsProvider");

  return context;
};
