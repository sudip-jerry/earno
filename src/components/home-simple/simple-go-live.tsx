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
import { BadgeCheck, FlaskConical, ShieldAlert, Sparkles } from "lucide-react";

export type SimpleGoLiveProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLive: boolean;
  needsUpgrade: boolean;
  pending: boolean;
  onGoLive: () => void;
  onBackToPaper: () => void;
  onUpgrade: () => void;
};

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[12.5px] leading-relaxed">
      <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
      <span>{children}</span>
    </li>
  );
}

export function SimpleGoLive({
  open,
  onOpenChange,
  isLive,
  needsUpgrade,
  pending,
  onGoLive,
  onBackToPaper,
  onUpgrade,
}: SimpleGoLiveProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {isLive ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <FlaskConical className="size-4 text-amber-500" />
                Switch back to Practice?
              </AlertDialogTitle>
              <AlertDialogDescription>
                New trades will use simulated money again. Any live positions you already have stay
                open until they close normally.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep trading live</AlertDialogCancel>
              <AlertDialogAction onClick={onBackToPaper} disabled={pending}>
                {pending ? "Switching…" : "Back to Practice"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <BadgeCheck className="size-4 text-primary" />
                Go live with real money?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div>
                  <p>Here's what changes when you go live:</p>
                  <ul className="mt-3 space-y-2 text-foreground">
                    <Point>
                      Trades run with <b>real money</b> in your own exchange account.
                    </Point>
                    <Point>
                      earn'O never holds your funds — you stay in control and can switch back to
                      Practice any time.
                    </Point>
                    <Point>Start small. Real markets move, and losses are possible.</Point>
                  </ul>
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                    <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[12px] text-foreground/90">
                      Only invest what you can afford to lose. Past performance doesn't guarantee
                      future results.
                    </p>
                  </div>
                  {needsUpgrade && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                      <Sparkles className="size-4 text-primary shrink-0 mt-0.5" />
                      <p className="text-[12px] text-foreground/90">
                        Live trading needs an upgraded plan.{" "}
                        <button
                          type="button"
                          onClick={onUpgrade}
                          className="font-semibold text-primary underline underline-offset-2"
                        >
                          See plans
                        </button>
                        .
                      </p>
                    </div>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay on Practice</AlertDialogCancel>
              <AlertDialogAction
                onClick={onGoLive}
                disabled={pending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {pending ? "Going live…" : "Go Live"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
