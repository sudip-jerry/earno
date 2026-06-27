import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onClose: () => void;
};

function formatIst(iso: string): string {
  if (!iso) return "Unknown";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return "Unknown";
  }
}

export function AppVersionDialog({ open, onClose }: Props) {
  const commitSha: string = import.meta.env.VITE_APP_COMMIT_SHA ?? "";
  const buildTime: string = import.meta.env.VITE_APP_BUILD_TIME ?? "";
  const env: string = import.meta.env.MODE ?? "unknown";

  const lastUpdated = buildTime ? formatIst(buildTime) : "Unknown";
  const shortSha = commitSha || "Unknown";
  const envLabel = env.charAt(0).toUpperCase() + env.slice(1);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xs w-full rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">App info</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <InfoRow label="App" value="earnO" />
          <InfoRow label="Last updated" value={lastUpdated} />
          <InfoRow label="Build" value={shortSha} mono />
          <InfoRow label="Environment" value={envLabel} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`text-xs font-medium text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
