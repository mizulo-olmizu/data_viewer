import { Button } from "@/components/ui/button";
import { LuDownload } from "react-icons/lu";
import { toast } from "sonner";
import { downloadCsv } from "@/csvExport";

export interface ExportActionsProps {
  getCsv: () => string;
  defaultFileName: string;
}

export default function ExportActions({
  getCsv,
  defaultFileName,
}: ExportActionsProps) {
  const handleDownload = () => {
    downloadCsv(getCsv(), defaultFileName)
      .then((saved) => {
        if (saved) {
          toast("CSVを保存しました");
        }
      })
      .catch((err) => toast.error(`保存に失敗しました: ${err}`));
  };

  return (
    <Button variant="outline" size="sm" onClick={handleDownload}>
      <LuDownload />
      CSV
    </Button>
  );
}
