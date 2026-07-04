import { useMarketMode, type MarketMode } from "@/hooks/use-market-mode";

export function SimpleMarketTabs() {
  const { market, setMarket } = useMarketMode();
  const opts: { v: MarketMode; label: string }[] = [
    { v: "all", label: "All" },
    { v: "futures", label: "Futures" },
    { v: "spot", label: "Coins" },
  ];

  return (
    <div className="grid grid-cols-3 rounded-full bg-muted p-0.5 text-[11px] font-semibold text-muted-foreground">
      {opts.map((o) => {
        const active = market === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => setMarket(o.v)}
            className={`h-6 rounded-full transition ${active ? "bg-card text-primary shadow-sm" : "hover:text-foreground"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
