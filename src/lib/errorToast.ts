import { toast } from "sonner";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

// 通常のtoast.errorに「コピー」アクションを付けたもの。エラー内容をそのまま
// 貼り付けて調べたい/報告したいことがあるため、エラー系トーストは常にこちらを使う。
export function errorToast(message: string) {
  toast.error(message, {
    action: {
      label: "コピー",
      onClick: () => {
        writeText(message).catch(() => {});
      },
    },
  });
}
