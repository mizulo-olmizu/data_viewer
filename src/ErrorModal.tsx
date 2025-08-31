import { LuTriangleAlert } from "react-icons/lu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ErrorModalProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  message: string;
}

export function ErrorModal({ open, onOpenChange, message }: ErrorModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-red-400">
            <div className="flex items-center">
              <LuTriangleAlert className="text-lg mr-1" />
              エラーが発生しました
            </div>
          </DialogTitle>
        </DialogHeader>

        {message}
      </DialogContent>
    </Dialog>
  );
}

export default ErrorModal;
