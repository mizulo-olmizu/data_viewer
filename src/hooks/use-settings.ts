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
};

export const defaultSettings: Settings = {
  theme: "system",
  inferSchemaLength: { kind: "default" },
  limitDialogThreshold: 1_000_000,
  copyIncludeHeaders: true,
  focusOnExternalUpdate: true,
};

export type SettingsProviderState = {
  settings: Settings;
  setSettings: (settings: Settings) => void;
};

const initialState: SettingsProviderState = {
  settings: defaultSettings,
  setSettings: () => null,
};

export const SettingsProviderContext =
  createContext<SettingsProviderState>(initialState);

export const useSettings = () => {
  const context = useContext(SettingsProviderContext);

  if (context === undefined)
    throw new Error("useSettings must be used within a SettingsProvider");

  return context;
};
