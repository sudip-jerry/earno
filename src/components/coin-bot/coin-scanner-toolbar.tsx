import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { runCoinScan } from "@/lib/coin-bot/coin-bot.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type CoinFilter = "all" | "buy" | "hold" | "wait" | "avoid" | "sell";

const FILTERS: { id: CoinFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "buy", label: "Buy" },
  { id: "hold", label: "Hold" },
  { id: "wait", label: "Wait" },
  { id: "sell", label: "Sell" },
  { id: "avoid", label: "Avoid" },
];

export function CoinScannerToolbar({
  filter,
  onFilter,
  query,
  onQuery,
}: {
  filter: CoinFilter;
  onFilter: (f: CoinFilter) => void;
  query: string;
  onQuery: (q: string) => void;
}) {
  const qc = useQueryClient();
  const scanFn = useServerFn(runCoinScan);

  const scan = useMutation({
    mutationFn: () => scanFn(),
    onSuccess: (r) => {
      if ((r as any)?.ok) {
        toast.success(
          `Scan complete · ${(r as any).scanned} coins · ${(r as any).signals} signals`,
        );
        qc.invalidateQueries({ queryKey: ["coin_signals"] });
        qc.invalidateQueries({ queryKey: ["coin_holdings"] });
        qc.invalidateQueries({ queryKey: ["coin_portfolio"] });
      } else toast.error((r as any)?.error ?? "Scan failed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Scan failed"),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search coin"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => scan.mutate()} disabled={scan.isPending}>
          <RefreshCw className={`size-3.5 mr-1 ${scan.isPending ? "animate-spin" : ""}`} />
          Scan
        </Button>
      </div>
      <div className="flex gap-1 overflow-x-auto -mx-1 px-1 scrollbar-none">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => onFilter(f.id)}
            className={`shrink-0 text-[11px] px-2.5 h-7 rounded-full border transition ${
              filter === f.id
                ? "bg-foreground text-background border-foreground"
                : "bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
