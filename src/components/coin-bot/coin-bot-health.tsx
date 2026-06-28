import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Activity, Settings as Cog } from "lucide-react";

import { getCoinConfig, updateCoinConfig } from "@/lib/coin-bot/coin-bot.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrency } from "@/hooks/use-currency";

export function CoinBotHealth() {
  const qc = useQueryClient();
  const cfgFn = useServerFn(getCoinConfig);
  const updFn = useServerFn(updateCoinConfig);
  const cfg = useQuery({ queryKey: ["coin_cfg"], queryFn: () => cfgFn() });
  const c = cfg.data;
  const [open, setOpen] = useState(false);
  const [allocated, setAllocated] = useState<string>("");
  const [maxHoldings, setMaxHoldings] = useState<string>("");
  const [minConf, setMinConf] = useState<string>("");
  const [scanMin, setScanMin] = useState<string>("");

  useEffect(() => {
    if (c) {
      setAllocated(String(c.allocated_capital_usdt));
      setMaxHoldings(String(c.max_holdings));
      setMinConf(String(c.min_confidence));
      setScanMin(String(c.scan_interval_min));
    }
  }, [c]);

  const upd = useMutation({
    mutationFn: (v: any) => updFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coin_cfg"] });
      qc.invalidateQueries({ queryKey: ["coin_portfolio"] });
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  if (!c) {
    return <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">Loading bot…</div>;
  }

  const enabled = c.enabled;

  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2.5">
        <span className={`size-8 grid place-items-center rounded-full ${enabled ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
          <Activity className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Coin Bot · {enabled ? "Running" : "Paused"}</p>
          <p className="text-[11px] text-muted-foreground capitalize">
            {c.mode} mode · scan every {c.scan_interval_min}m · up to {c.max_holdings} holdings · min {c.min_confidence}% conf
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <Cog className="size-3.5 mr-1" /> {open ? "Close" : "Edit"}
        </Button>
      </div>

      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1" variant={enabled ? "outline" : "default"} onClick={() => upd.mutate({ enabled: !enabled })}>
          {enabled ? "Pause bot" : "Start bot"}
        </Button>
        <Button size="sm" className="flex-1" variant={c.mode === "intraday" ? "default" : "outline"} onClick={() => upd.mutate({ mode: "intraday" })}>
          Intraday
        </Button>
        <Button size="sm" className="flex-1" variant={c.mode === "swing" ? "default" : "outline"} onClick={() => upd.mutate({ mode: "swing" })}>
          Swing
        </Button>
      </div>

      {open && (
        <div className="mt-4 space-y-3 border-t pt-3">
          <Field label="Allocated capital (USDT)" value={allocated} onChange={setAllocated} onSave={() => upd.mutate({ allocated_capital_usdt: Number(allocated) })} />
          <Field label="Max holdings" value={maxHoldings} onChange={setMaxHoldings} onSave={() => upd.mutate({ max_holdings: Number(maxHoldings) })} />
          <Field label="Min confidence (%)" value={minConf} onChange={setMinConf} onSave={() => upd.mutate({ min_confidence: Number(minConf) })} />
          <Field label="Scan interval (min)" value={scanMin} onChange={setScanMin} onSave={() => upd.mutate({ scan_interval_min: Number(scanMin) })} />
          <p className="text-[11px] text-muted-foreground">
            Intraday: short-term momentum, can carry overnight. Swing: holds up to {c.max_holding_days} days.
          </p>
        </div>
      )}
    </section>
  );
}

function Field({ label, value, onChange, onSave }: { label: string; value: string; onChange: (v: string) => void; onSave: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted-foreground flex-1">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-24 text-xs" inputMode="decimal" />
      <Button size="sm" variant="outline" onClick={onSave}>Save</Button>
    </div>
  );
}
