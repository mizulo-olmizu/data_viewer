import { useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ValidatedNumberInput } from "@/components/ValidatedNumberInput";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  LuPlus,
  LuCopy,
  LuChevronsRight,
  LuChevronDown,
  LuChevronRight,
  LuPencil,
  LuTrash2,
  LuMemoryStick,
  LuFolderOpen,
  LuSave,
  LuFolderSearch2,
  LuSettings,
  LuScrollText,
} from "react-icons/lu";
import { Status, ExtractDataResult } from "@/types";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { errorToast } from "@/lib/errorToast";
import { pickDatabaseSaveAsPath, pickDatabaseToOpen } from "@/databaseFile";
import { cn } from "@/lib/utils";
import SettingsDialog from "@/components/SettingsDialog";
import LogViewer from "@/components/LogViewer";
import { switchHttpPort } from "@/handler";
import { useSettings } from "@/hooks/use-settings";

const IN_MEMORY_DB_PATH = ":memory:";

export type SwitchTarget = { kind: "file"; path: string } | { kind: "memory" };

export interface AppSidebarHandle {
  requestSwitch: (target: SwitchTarget) => void;
}

function switchTargetLabel(target: SwitchTarget): string {
  return target.kind === "file" ? target.path : "新しいメモリ上のデータベース";
}

function dbDisplayName(path: string | null | undefined): string {
  if (path === undefined || path === null) {
    return "";
  }
  if (path === IN_MEMORY_DB_PATH) {
    return path;
  }
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function RowActions({
  onCopy,
  onInsert,
  showInsert,
}: {
  onCopy: () => void;
  onInsert: () => void;
  showInsert: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-5"
            onClick={onCopy}
          >
            <LuCopy className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>コピー</TooltipContent>
      </Tooltip>
      {showInsert && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-5"
              onClick={onInsert}
            >
              <LuChevronsRight className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>SQLに挿入</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function TableRowActions({
  onCopy,
  onInsert,
  showInsert,
  onRename,
  onDelete,
}: {
  onCopy: () => void;
  onInsert: () => void;
  showInsert: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-5"
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
          >
            <LuCopy className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>コピー</TooltipContent>
      </Tooltip>
      {showInsert && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-5"
              onClick={(e) => {
                e.stopPropagation();
                onInsert();
              }}
            >
              <LuChevronsRight className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>SQLに挿入</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-5"
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
          >
            <LuPencil className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Rename</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-5"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <LuTrash2 className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete</TooltipContent>
      </Tooltip>
    </div>
  );
}

const FALLBACK_PORT = 3000;

// 稼働中は緑のパルスドット、停止中はグレーの静止ドットで状態を示す
// (URLをそのまま文で読ませるより、開発者ツールで一般的な接続状態インジケータに寄せた表現)
function StatusDot({ active }: { active: boolean }) {
  if (!active) {
    return (
      <span className="inline-block size-2 rounded-full bg-muted-foreground/50" />
    );
  }

  return (
    <span className="relative inline-flex size-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
      <span className="relative inline-flex size-2 rounded-full bg-green-500" />
    </span>
  );
}

function HttpPortIndicator({
  port,
  onCopy,
}: {
  port: number | null;
  onCopy: (text: string) => void;
}) {
  const { settings, setSettings } = useSettings();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [updateDefault, setUpdateDefault] = useState(false);
  const disabled = port === null;
  const url = disabled ? null : `http://localhost:${port}`;

  return (
    <span className="flex items-center gap-1">
      <Badge variant="outline" className="gap-1.5 font-normal">
        <StatusDot active={!disabled} />
        {disabled ? "HTTP disabled" : `Port ${port}`}
      </Badge>
      {url && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-5"
              onClick={() => onCopy(url)}
            >
              <LuCopy className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>URLをコピー</TooltipContent>
        </Tooltip>
      )}
      <Popover
        open={popoverOpen}
        onOpenChange={(open) => {
          if (open) {
            setUpdateDefault(false);
          }
          setPopoverOpen(open);
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" className="size-5">
                <LuPencil className="size-3" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {disabled ? "ポートを指定して起動" : "ポートを変更"}
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-64">
          <div className="flex flex-col gap-2">
            <Label className="text-xs">
              {disabled
                ? "ポートを指定してHTTPサーバーを起動"
                : "現在稼働中のポートを変更"}
            </Label>
            <ValidatedNumberInput
              value={port ?? FALLBACK_PORT}
              min={1024}
              max={65535}
              autoFocus
              onApply={async (value) => {
                // switchHttpPortは実際のbind結果を待ってから返る/rejectするため、
                // 失敗時はここでthrowし、ValidatedNumberInput側のインラインエラー表示に
                // 任せる(ポップオーバーも閉じない)
                await switchHttpPort(value);
                if (updateDefault) {
                  // silent指定で、setSettings内蔵のトーストとインラインエラーが
                  // 二重に出ないようにする(失敗時は実際のエラーがそのままthrowされる)
                  await setSettings(
                    { ...settings, httpPort: value },
                    { silent: true },
                  );
                }
                setPopoverOpen(false);
              }}
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="http-port-update-default"
                checked={updateDefault}
                onCheckedChange={(checked) =>
                  setUpdateDefault(checked === true)
                }
              />
              <Label
                htmlFor="http-port-update-default"
                className="text-xs font-normal"
              >
                次回起動時のデフォルトにも設定する
              </Label>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}

export type AppSidebarProps = {
  status: Status | null;
  tableData: ExtractDataResult | null;
  tableList: string[];
  onTableSelect: (tableName: string) => void;
  onDropTable: (tableName: string) => void;
  onRenameTable: (oldName: string, newName: string) => void;
  onUpload: (filePath: string) => void;
  onInsertToQuery: (text: string) => void;
  onOpenDatabase: (path: string) => Promise<void>;
  onNewInMemoryDatabase: () => Promise<void>;
  onSaveDatabaseAs: (path: string) => Promise<void>;
  onSaveDatabaseCopy: (path: string) => Promise<void>;
  sqlEditorOpen: boolean;
};

export function AppSidebar({
  status,
  tableData,
  tableList,
  onTableSelect,
  onDropTable,
  onRenameTable,
  onUpload,
  onInsertToQuery,
  onOpenDatabase,
  onNewInMemoryDatabase,
  onSaveDatabaseAs,
  onSaveDatabaseCopy,
  sqlEditorOpen,
  ref,
}: AppSidebarProps & { ref?: Ref<AppSidebarHandle> }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  // TODO ロジックを分離する
  const fileTypes = ["csv", "tsv", "json", "jsonl", "parquet"];
  const filters =
    fileTypes === undefined
      ? undefined
      : [{ name: "*", extensions: fileTypes }];

  const fileSelect = () => {
    open({
      multiple: false,
      filters,
    }).then((file) => {
      if (typeof file === "string") {
        onUpload(file);
      }
    });
  };

  const copyToClipboard = (text: string) => {
    writeText(text)
      .then(() => toast(`"${text}" をコピーしました`))
      .catch((err) => errorToast(`コピーに失敗しました: ${err}`));
  };

  const isInMemory = status?.dbPath === IN_MEMORY_DB_PATH;
  const hasData = tableList.length > 0;
  const [pendingSwitch, setPendingSwitch] = useState<SwitchTarget | null>(null);
  const [pendingDeleteTable, setPendingDeleteTable] = useState<string | null>(
    null,
  );
  const [tablesOpen, setTablesOpen] = useState(true);
  const [schemaOpen, setSchemaOpen] = useState(true);
  const [renamingTable, setRenamingTable] = useState<string | null>(null);
  const renameCancelledRef = useRef(false);

  const performSwitch = async (target: SwitchTarget) => {
    if (target.kind === "file") {
      await onOpenDatabase(target.path);
    } else {
      await onNewInMemoryDatabase();
    }
  };

  const requestSwitch = (target: SwitchTarget) => {
    // 既に開いているファイルを選び直した場合は何もしない
    if (target.kind === "file" && target.path === status?.dbPath) {
      toast("このデータベースは既に開いています");
      return;
    }
    // メモリ上にまだ何も無い(=失うデータが無い)場合は確認せずそのまま切り替える
    if (isInMemory && !hasData) {
      performSwitch(target);
      return;
    }
    setPendingSwitch(target);
  };

  // CLIの-d/--db-path(single-instance再起動)からのリクエストも、UI操作と同じ確認フローに乗せる
  useImperativeHandle(ref, () => ({
    requestSwitch,
  }));

  const handleOpenDatabaseSelect = () => {
    pickDatabaseToOpen().then((path) => {
      if (path !== null) {
        requestSwitch({ kind: "file", path });
      }
    });
  };

  const handleNewInMemoryDatabaseSelect = () => {
    requestSwitch({ kind: "memory" });
  };

  const handleSaveDatabaseAsSelect = () => {
    pickDatabaseSaveAsPath().then((path) => {
      if (path !== null) {
        onSaveDatabaseAs(path);
      }
    });
  };

  const handleRevealInFinder = () => {
    if (status?.dbPath == null || status.dbPath === IN_MEMORY_DB_PATH) {
      return;
    }
    revealItemInDir(status.dbPath).catch((err) =>
      errorToast(`Finderで表示できませんでした: ${err}`),
    );
  };

  const handleSwitchWithoutSaving = () => {
    if (pendingSwitch === null) {
      return;
    }
    performSwitch(pendingSwitch);
    setPendingSwitch(null);
  };

  const handleSaveAndSwitch = async () => {
    if (pendingSwitch === null) {
      return;
    }
    const savePath = await pickDatabaseSaveAsPath();
    // 保存先の選択をキャンセルした場合は、確認ダイアログを開いたままにする
    if (savePath === null) {
      return;
    }
    await onSaveDatabaseCopy(savePath);
    await performSwitch(pendingSwitch);
    setPendingSwitch(null);
  };

  const startRename = (tableName: string) => {
    renameCancelledRef.current = false;
    setRenamingTable(tableName);
  };

  const cancelRename = () => {
    renameCancelledRef.current = true;
    setRenamingTable(null);
  };

  const commitRename = (oldName: string, newValue: string) => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      setRenamingTable(null);
      return;
    }
    setRenamingTable(null);
    const trimmed = newValue.trim();
    if (trimmed === "" || trimmed === oldName) {
      return;
    }
    onRenameTable(oldName, trimmed);
  };

  const handleConfirmDelete = () => {
    if (pendingDeleteTable !== null) {
      onDropTable(pendingDeleteTable);
    }
    setPendingDeleteTable(null);
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarGroupLabel className="h-auto flex-wrap items-center justify-between gap-1 py-1 pr-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="min-w-0 flex-1 truncate">{`DB — ${dbDisplayName(status?.dbPath)}`}</span>
            </TooltipTrigger>
            <TooltipContent>{status?.dbPath}</TooltipContent>
          </Tooltip>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-5"
                  onClick={handleNewInMemoryDatabaseSelect}
                >
                  <LuMemoryStick className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New In-Memory Database</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-5"
                  onClick={handleOpenDatabaseSelect}
                >
                  <LuFolderOpen className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open Database...</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-5"
                  disabled={!isInMemory}
                  onClick={handleSaveDatabaseAsSelect}
                >
                  <LuSave className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save Database As...</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-5"
                  disabled={isInMemory}
                  onClick={handleRevealInFinder}
                >
                  <LuFolderSearch2 className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reveal in Finder</TooltipContent>
            </Tooltip>
          </div>
        </SidebarGroupLabel>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <LogViewer open={logsOpen} onOpenChange={setLogsOpen} />
        <AlertDialog
          open={pendingSwitch !== null}
          onOpenChange={(open) => {
            if (!open) {
              setPendingSwitch(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                データベースを切り替えますか？
              </AlertDialogTitle>
              <AlertDialogDescription>
                {isInMemory
                  ? "現在メモリ上にあるテーブルは保存されておらず、切り替えると失われます。"
                  : "現在のデータベースから切り替えます。"}
                {pendingSwitch !== null &&
                  `「${switchTargetLabel(pendingSwitch)}」に切り替えてよろしいですか？`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              {isInMemory && (
                // 保存先ダイアログをキャンセルした場合にAlertDialogを開いたままにしたいため、
                // クリックで即座に閉じるAlertDialogActionではなく、開閉を手動制御できる通常のButtonを使う
                <Button onClick={handleSaveAndSwitch}>Save & Switch</Button>
              )}
              <Button
                variant={isInMemory ? "destructive" : "default"}
                onClick={handleSwitchWithoutSaving}
              >
                {isInMemory ? "Switch without saving" : "Switch"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog
          open={pendingDeleteTable !== null}
          onOpenChange={(open) => {
            if (!open) {
              setPendingDeleteTable(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete table &quot;{pendingDeleteTable}&quot;?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button variant="destructive" onClick={handleConfirmDelete}>
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center justify-between gap-1 pr-1">
            <span
              className="flex items-center gap-1 cursor-pointer select-none"
              onClick={() => setTablesOpen((open) => !open)}
            >
              {tablesOpen ? (
                <LuChevronDown className="size-3.5" />
              ) : (
                <LuChevronRight className="size-3.5" />
              )}
              {`Tables (${tableList.length})`}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-5"
                  onClick={() => fileSelect()}
                >
                  <LuPlus className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Upload file</TooltipContent>
            </Tooltip>
          </SidebarGroupLabel>
          {tablesOpen && (
            <SidebarMenu>
              {tableList.map((tableName) => (
                <SidebarMenuItem key={tableName}>
                  <div
                    className={cn(
                      "group/row flex items-center justify-between gap-1 rounded-md px-2 py-1 hover:bg-sidebar-accent cursor-pointer",
                      tableName === tableData?.name &&
                        "bg-sidebar-accent font-semibold",
                    )}
                    onClick={() => onTableSelect(tableName)}
                  >
                    {renamingTable === tableName ? (
                      <Input
                        autoFocus
                        defaultValue={tableName}
                        className="h-6 text-sm"
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => commitRename(tableName, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          } else if (e.key === "Escape") {
                            cancelRename();
                          }
                        }}
                      />
                    ) : (
                      <span className="truncate text-sm">{tableName}</span>
                    )}
                    {renamingTable !== tableName && (
                      <div className="hidden group-hover/row:flex">
                        <TableRowActions
                          onCopy={() => copyToClipboard(tableName)}
                          onInsert={() => onInsertToQuery(tableName)}
                          showInsert={sqlEditorOpen}
                          onRename={() => startRename(tableName)}
                          onDelete={() => setPendingDeleteTable(tableName)}
                        />
                      </div>
                    )}
                  </div>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel
            className="cursor-pointer select-none"
            onClick={() => setSchemaOpen((open) => !open)}
          >
            {schemaOpen ? (
              <LuChevronDown className="size-3.5" />
            ) : (
              <LuChevronRight className="size-3.5" />
            )}
            Schema{tableData?.name ? ` — ${tableData.name}` : ""}
          </SidebarGroupLabel>
          {schemaOpen && (
            <SidebarMenu>
              {tableData?.schema.map((info, index) => (
                <SidebarMenuItem key={index}>
                  <div className="group/row flex items-center justify-between gap-1 rounded-md px-2 py-1 hover:bg-sidebar-accent">
                    <span className="truncate text-sm">{`${info.columnName}: ${info.columnType}`}</span>
                    <div className="hidden group-hover/row:flex">
                      <RowActions
                        onCopy={() => copyToClipboard(info.columnName)}
                        onInsert={() => onInsertToQuery(info.columnName)}
                        showInsert={sqlEditorOpen}
                      />
                    </div>
                  </div>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem className="flex flex-wrap items-center justify-between gap-1">
            <HttpPortIndicator
              port={status?.port ?? null}
              onCopy={copyToClipboard}
            />
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-5 shrink-0"
                    onClick={() => setLogsOpen(true)}
                  >
                    <LuScrollText className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Logs</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-5 shrink-0"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <LuSettings className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Settings</TooltipContent>
              </Tooltip>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
