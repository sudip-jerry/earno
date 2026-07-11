import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Home as HomeIcon, Radar, Receipt, MoreHorizontal } from "lucide-react";
import earnoStacked from "@/assets/earno-stacked.jpg.asset.json";
import { SimpleMarketTabs } from "@/components/home-simple/simple-market-tabs";

export function BeginnerShell({
  showMarketToggle = false,
  children,
}: {
  showMarketToggle?: boolean;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();

  return (
    <div className="min-h-svh bg-background pb-28">
      <header className="px-5 pt-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: "/about" })}
            aria-label="About earn'O"
            className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img
              src={earnoStacked.url}
              alt="earn'O"
              className="h-11 w-auto select-none"
              draggable={false}
            />
          </button>
        </div>
      </header>

      {showMarketToggle && (
        <div className="px-5 mt-2">
          <SimpleMarketTabs />
        </div>
      )}

      {children}

      <BeginnerTabBar />
    </div>
  );
}

const TABS = [
  { to: "/", label: "Home", Icon: HomeIcon },
  { to: "/scanner", label: "Scanner", Icon: Radar },
  { to: "/positions", label: "Trades", Icon: Receipt },
  { to: "/more", label: "More", Icon: MoreHorizontal },
] as const;

function BeginnerTabBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav aria-label="Primary" className="fixed bottom-4 inset-x-0 z-40 pointer-events-none px-6">
      <div className="mx-auto grid h-14 max-w-[340px] grid-cols-4 rounded-full border bg-card/95 shadow-lg backdrop-blur pointer-events-auto">
        {TABS.map(({ to, label, Icon }) => {
          const active = pathname === to;
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-1 transition ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="size-[18px]" />
              <span className="text-[10.5px] font-medium leading-none">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
