import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LuCopy } from "react-icons/lu";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { errorToast } from "@/lib/errorToast";
import { getLogs } from "@/handler";
import { LogEntry, LogLevel } from "@/types";

// バックエンド側のリングバッファ(MAX_LOG_ENTRIES)と同じ上限にしておく。
const MAX_LOGS = 1000;

const LEVEL_VARIANT: Record<LogLevel, "outline" | "secondary" | "destructive"> =
  {
    trace: "outline",
    debug: "outline",
    info: "secondary",
    warn: "destructive",
    error: "destructive",
  };

function formatEntry(entry: LogEntry): string {
  const time = new Date(entry.timestampMs).toLocaleString();
  return `${time} [${entry.level.toUpperCase()}] ${entry.message}`;
}

export interface LogViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function LogViewer({ open, onOpenChange }: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // ダイアログの開閉に関わらず常時購読しておく(開いた瞬間に読み込み待ちにならないよう、
  // バックグラウンドでも履歴を溜め続ける)。
  useEffect(() => {
    let ignore = false;
    let unlisten: UnlistenFn | undefined;

    getLogs()
      .then((initial) => {
        if (!ignore) {
          setLogs(initial);
        }
      })
      .catch(() => {});

    listen<LogEntry>("app-log", (event) => {
      setLogs((prev) => {
        const next = [...prev, event.payload];
        return next.length > MAX_LOGS
          ? next.slice(next.length - MAX_LOGS)
          : next;
      });
    }).then((fn) => {
      if (ignore) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      ignore = true;
      if (unlisten != null) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, logs.length]);

  const handleCopyEntry = (entry: LogEntry) => {
    writeText(formatEntry(entry))
      .then(() => toast.success("コピーしました"))
      .catch((err) => errorToast(`コピーに失敗しました: ${err}`));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Logs</DialogTitle>
          <DialogDescription>
            このセッション中に記録されたログ({logs.length}件)
          </DialogDescription>
        </DialogHeader>

        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto rounded-md border p-2 font-mono text-xs"
        >
          {logs.length === 0 ? (
            <p className="text-muted-foreground p-2">ログはまだありません。</p>
          ) : (
            logs.map((entry, index) => (
              <div
                key={`${entry.timestampMs}_${index}`}
                className="group/row flex items-start gap-2 border-b py-1 last:border-b-0"
              >
                <span className="text-muted-foreground shrink-0 whitespace-nowrap">
                  {new Date(entry.timestampMs).toLocaleTimeString()}
                </span>
                <Badge
                  variant={LEVEL_VARIANT[entry.level]}
                  className="shrink-0 uppercase"
                >
                  {entry.level}
                </Badge>
                <span className="flex-1 whitespace-pre-wrap break-all">
                  {entry.message}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-5 shrink-0 opacity-0 group-hover/row:opacity-100"
                      onClick={() => handleCopyEntry(entry)}
                    >
                      <LuCopy className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>コピー</TooltipContent>
                </Tooltip>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
