import { AlertTriangle } from "lucide-react";

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

/**
 * Shared "switch to Live trading" confirmation. Same wording and weight
 * everywhere the app moves a user off paper, so the moment reads the same
 * on the Bot screen, in Settings, and in the beginner Go-Live flow.
 */
export function GoLiveDialog({
  open,
  onOpenChange,
  onConfirm,
  dailyCapPct,
  what = "Real orders",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
  dailyCapPct?: number;
  what?: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            Switch to Live trading?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {what} will be placed using your real funds.
            {dailyCapPct != null ? ` Your daily-loss cap is ${dailyCapPct}%.` : ""} You can switch
            back to Paper anytime.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay on Paper</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Go Live
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
