import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PendingCopyConfirmation } from "@/useCellRangeSelection";

export interface LargeCopyConfirmDialogProps {
  pending: PendingCopyConfirmation | null;
}

// セル範囲選択のコピー対象が大量(useCellRangeSelectionのLARGE_COPY_ROW_THRESHOLD超)の場合の
// 確認ダイアログ。Grid(Table.tsx)・Glimpse(GlimpseView.tsx)どちらも自前のuseCellRangeSelection
// インスタンスを持つため、それぞれでこのコンポーネントを描画する。
export default function LargeCopyConfirmDialog({
  pending,
}: LargeCopyConfirmDialogProps) {
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) {
          pending?.onCancel();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>大量のセルをコピーしますか？</AlertDialogTitle>
          <AlertDialogDescription>
            選択範囲は{pending?.rowCount.toLocaleString()}
            行あり、コピーに時間がかかる可能性があります。続行しますか？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => pending?.onCancel()}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => pending?.onConfirm()}>
            Copy
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
