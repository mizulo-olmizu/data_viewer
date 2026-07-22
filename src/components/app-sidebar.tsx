import { useImperativeHandle, useState, type Ref } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LuUpload, LuCopy, LuChevronsRight, LuDatabase } from "react-icons/lu";
import { Status, ExtractDataResultConverted } from "@/types";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { pickDatabaseSaveAsPath, pickDatabaseToOpen } from "@/databaseFile";

const IN_MEMORY_DB_PATH = ":memory:";

export type SwitchTarget = { kind: "file"; path: string } | { kind: "memory" };

export interface AppSidebarHandle {
  requestSwitch: (target: SwitchTarget) => void;
}

function switchTargetLabel(target: SwitchTarget): string {
  return target.kind === "file" ? target.path : "新しいメモリ上のデータベース";
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

export type AppSidebarProps = {
  status: Status | null;
  tableData: ExtractDataResultConverted | null;
  tableList: string[];
  onTableSelect: (tableName: string) => void;
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
  onUpload,
  onInsertToQuery,
  onOpenDatabase,
  onNewInMemoryDatabase,
  onSaveDatabaseAs,
  onSaveDatabaseCopy,
  sqlEditorOpen,
  ref,
}: AppSidebarProps & { ref?: Ref<AppSidebarHandle> }) {
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
      .catch((err) => toast.error(`コピーに失敗しました: ${err}`));
  };

  const isInMemory = status?.dbPath === IN_MEMORY_DB_PATH;
  const hasData = tableList.length > 0;
  const [pendingSwitch, setPendingSwitch] = useState<SwitchTarget | null>(null);

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

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center justify-between gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate text-sm">DB🗂️: {status?.dbPath}</span>
            </TooltipTrigger>
            <TooltipContent>{status?.dbPath}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-6 shrink-0">
                <LuDatabase className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={handleNewInMemoryDatabaseSelect}>
                New In-Memory Database
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleOpenDatabaseSelect}>
                Open Database...
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!isInMemory}
                onSelect={handleSaveDatabaseAsSelect}
              >
                Save Database As...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
        <Select
          value={tableData?.name}
          onValueChange={(val) => onTableSelect(val)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select Table" />
          </SelectTrigger>
          <SelectContent>
            {tableList.map((tableName) => (
              <SelectItem key={tableName} value={tableName}>
                {tableName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="icon" onClick={() => fileSelect()}>
          <LuUpload />
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              {tableData?.name && (
                <div className="group/row flex items-center justify-between gap-1 rounded-md px-2 py-1 hover:bg-sidebar-accent">
                  <span className="truncate text-sm">{tableData.name}</span>
                  <div className="hidden group-hover/row:flex">
                    <RowActions
                      onCopy={() => copyToClipboard(tableData.name)}
                      onInsert={() => onInsertToQuery(tableData.name)}
                      showInsert={sqlEditorOpen}
                    />
                  </div>
                </div>
              )}
              <SidebarMenuSub>
                {tableData?.schema.map((info, index) => (
                  <SidebarMenuSubItem key={index}>
                    <div className="flex items-center justify-between gap-1 rounded-md px-2 py-1 -mr-6 hover:bg-sidebar-accent">
                      <span className="truncate text-sm">{`${info.columnName}: ${info.columnType}`}</span>
                      <div className="hidden group-hover/menu-sub-item:flex">
                        <RowActions
                          onCopy={() => copyToClipboard(info.columnName)}
                          onInsert={() => onInsertToQuery(info.columnName)}
                          showInsert={sqlEditorOpen}
                        />
                      </div>
                    </div>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {status?.port ? (
              <span>
                Ready to accept HTTP requests 🚀 : http://localhost:
                {status.port}
              </span>
            ) : (
              <span>HTTP Request disabled 🛑</span>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
