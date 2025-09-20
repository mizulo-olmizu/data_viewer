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
              {tableData?.name}
              <SidebarMenuSub>
                {tableData?.schema.map((info, index) => (
                  <SidebarMenuSubItem key={index}>
                    <span>{`${info.columnName}: ${info.columnType}`}</span>
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
