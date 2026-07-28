import { Button } from "@/components/ui/button";
import { LuDownload } from "react-icons/lu";
import { toast } from "sonner";
import { errorToast } from "@/lib/errorToast";
import { pickCsvSavePath } from "@/csvExport";

export interface ExportActionsProps {
  // 現在のソート/フィルタ条件に一致する全行をdestPathへ書き出す(サーバー側`COPY TO`)。
  onExport: (destPath: string) => Promise<void>;
  defaultFileName: string;
}

export default function ExportActions({
  onExport,
  defaultFileName,
}: ExportActionsProps) {
  const handleDownload = async () => {
    const path = await pickCsvSavePath(defaultFileName);
    if (!path) return;

    try {
      await onExport(path);
      toast("CSVを保存しました");
    } catch (err) {
      errorToast(`保存に失敗しました: ${err}`);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleDownload}>
      <LuDownload />
      CSV
    </Button>
  );
}
