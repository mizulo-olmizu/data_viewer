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
import { LuUpload } from "react-icons/lu";
import { Status, ExtractDataResultConverted } from "@/types";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

export type AppSidebarProps = {
  status: Status | null;
  tableData: ExtractDataResultConverted | null;
  tableList: string[];
  onTableSelect: (tableName: string) => void;
  onUpload: (filePath: string) => void;
};

export function AppSidebar({
  status,
  tableData,
  tableList,
  onTableSelect,
  onUpload,
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
                <span
                  className="cursor-pointer hover:underline"
                  title="クリックしてテーブル名をコピー"
                  onClick={() => copyToClipboard(tableData.name)}
                >
                  {tableData.name}
                </span>
              )}
              <SidebarMenuSub>
                {tableData?.schema.map((info, index) => (
                  <SidebarMenuSubItem key={index}>
                    <span
                      className="cursor-pointer hover:underline"
                      title="クリックしてカラム名をコピー"
                      onClick={() => copyToClipboard(info.columnName)}
                    >{`${info.columnName}: ${info.columnType}`}</span>
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
