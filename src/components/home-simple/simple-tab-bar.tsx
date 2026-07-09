import { Home as HomeIcon, TrendingUp, Receipt, MoreHorizontal } from "lucide-react";

export type SimpleTab = "home" | "earnings" | "trades" | "more";

const ITEMS: { k: SimpleTab; label: string; Icon: typeof HomeIcon }[] = [
  { k: "home", label: "Home", Icon: HomeIcon },
  { k: "earnings", label: "Earnings", Icon: TrendingUp },
  { k: "trades", label: "Trades", Icon: Receipt },
  { k: "more", label: "More", Icon: MoreHorizontal },
];

export function SimpleTabBar({
  active,
  onNavigate,
}: {
  active: SimpleTab;
  onNavigate: (t: SimpleTab) => void;
}) {
  return (
    <nav
      aria-label="Simple primary"
      className="fixed bottom-4 inset-x-0 z-40 pointer-events-none px-6"
    >
      <div className="mx-auto grid h-14 max-w-[340px] grid-cols-4 rounded-full border bg-card/95 shadow-lg backdrop-blur pointer-events-auto">
        {ITEMS.map(({ k, label, Icon }) => {
          const on = active === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onNavigate(k)}
              aria-current={on ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-1 transition ${on ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="size-[18px]" />
              <span className="text-[10.5px] font-medium leading-none">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
