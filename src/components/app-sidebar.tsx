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
import { LuUpload, LuCopy, LuChevronsRight } from "react-icons/lu";
import { Status, ExtractDataResultConverted } from "@/types";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

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
  sqlEditorOpen: boolean;
};

export function AppSidebar({
  status,
  tableData,
  tableList,
  onTableSelect,
  onUpload,
  onInsertToQuery,
  sqlEditorOpen,
}: AppSidebarProps) {
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

  return (
    <Sidebar>
      <SidebarHeader>
        <span>DB🗂️: {status?.dbPath}</span>
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
