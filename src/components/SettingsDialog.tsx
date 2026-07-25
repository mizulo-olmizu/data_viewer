import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useSettings, type Theme } from "@/hooks/use-settings";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
      {children}
    </h3>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label className="text-sm font-normal">{label}</Label>
        {description && (
          <p className="text-muted-foreground text-xs">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsDialog({
  open,
  onOpenChange,
}: SettingsDialogProps) {
  const { settings, setSettings } = useSettings();

  const inferSchemaLengthKind = settings.inferSchemaLength.kind;
  const inferSchemaLengthCustomValue =
    settings.inferSchemaLength.kind === "custom"
      ? settings.inferSchemaLength.value
      : 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>アプリ全体の表示・動作設定。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <SectionTitle>表示</SectionTitle>
          <SettingRow label="テーマ">
            <Select
              value={settings.theme}
              onValueChange={(value) =>
                setSettings({ ...settings, theme: value as Theme })
              }
            >
              <SelectTrigger size="sm" className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow
            label="プライマリ/セカンダリカラー"
            description="近日対応予定"
          >
            <span className="text-muted-foreground text-xs">Coming soon</span>
          </SettingRow>
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <SectionTitle>データ取り込み</SectionTitle>
          <SettingRow
            label="Infer schema length"
            description="アップロード/ドラッグ&ドロップ時にスキーマ推論に使う既定の行数"
          >
            <div className="flex items-center gap-2">
              <Select
                value={inferSchemaLengthKind}
                onValueChange={(value) => {
                  if (value === "default") {
                    setSettings({
                      ...settings,
                      inferSchemaLength: { kind: "default" },
                    });
                  } else if (value === "inf") {
                    setSettings({
                      ...settings,
                      inferSchemaLength: { kind: "inf" },
                    });
                  } else {
                    setSettings({
                      ...settings,
                      inferSchemaLength: {
                        kind: "custom",
                        value: inferSchemaLengthCustomValue,
                      },
                    });
                  }
                }}
              >
                <SelectTrigger size="sm" className="w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="inf">Inf</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              {inferSchemaLengthKind === "custom" && (
                <Input
                  type="number"
                  min={1}
                  className="h-8 w-20"
                  value={inferSchemaLengthCustomValue}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isFinite(value) && value > 0) {
                      setSettings({
                        ...settings,
                        inferSchemaLength: { kind: "custom", value },
                      });
                    }
                  }}
                />
              )}
            </div>
          </SettingRow>
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <SectionTitle>テーブル表示</SectionTitle>
          <SettingRow
            label="LIMIT確認ダイアログの閾値"
            description="この行数を超えるデータを取り込む際に確認を促す(ダイアログ自体は未実装)"
          >
            <Input
              type="number"
              min={1}
              className="h-8 w-28"
              value={settings.limitDialogThreshold}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value) && value > 0) {
                  setSettings({ ...settings, limitDialogThreshold: value });
                }
              }}
            />
          </SettingRow>
          <SettingRow
            label="セル範囲コピー時に行番号・列名を付与"
            description="Cmd/Ctrl+Cでのコピー時、先頭行に列名・各行先頭に行番号を含める"
          >
            <Checkbox
              checked={settings.copyIncludeHeaders}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  copyIncludeHeaders: checked === true,
                })
              }
            />
          </SettingRow>
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <SectionTitle>アプリケーション</SectionTitle>
          <SettingRow
            label="外部からの操作時に最前面化"
            description="他プロセス(CLI/HTTP)からデータ登録があった際、ウィンドウを最前面に出す"
          >
            <Checkbox
              checked={settings.focusOnExternalUpdate}
              onCheckedChange={(checked) =>
                setSettings({
                  ...settings,
                  focusOnExternalUpdate: checked === true,
                })
              }
            />
          </SettingRow>
        </div>
      </DialogContent>
    </Dialog>
  );
}
