import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Crown,
  Settings as Cog,
  MoreVertical,
  Home as HomeIcon,
  Radar,
  Receipt,
  MoreHorizontal,
  HelpCircle,
  Info,
  LineChart,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import earnoStacked from "@/assets/earno-stacked.jpg.asset.json";
import { getMyEntitlements } from "@/lib/plans.functions";
import { PLAN_NAME, type PlanTier } from "@/lib/plans";
import { SimpleMarketTabs } from "@/components/home-simple/simple-market-tabs";

function IconBtn({
  children,
  ariaLabel,
  onClick,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="size-8 grid place-items-center rounded-full hover:bg-muted text-foreground"
    >
      {children}
    </button>
  );
}

export function BeginnerShell({
  showMarketToggle = false,
  children,
}: {
  showMarketToggle?: boolean;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const entFn = useServerFn(getMyEntitlements);
  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => entFn() });
  const tier: PlanTier = ent.data?.tier ?? "free";
  const isAdmin = !!ent.data?.isAdmin;

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
          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More"
                  className="size-8 grid place-items-center rounded-full hover:bg-muted text-foreground"
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {PLAN_NAME[tier]} plan {isAdmin && "· Admin"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate({ to: "/upgrade" })}>
                  <Crown className="size-4 mr-2" /> Plan & Upgrade
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate({ to: "/movers" })}>
                  <LineChart className="size-4 mr-2" /> Movers
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate({ to: "/help" })}>
                  <HelpCircle className="size-4 mr-2" /> Help & Support
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate({ to: "/about" })}>
                  <Info className="size-4 mr-2" /> About
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate({ to: "/admin" })}>
                      <Crown className="size-4 mr-2 text-primary" /> Admin console
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <IconBtn ariaLabel="Settings" onClick={() => navigate({ to: "/settings" })}>
              <Cog className="size-4" />
            </IconBtn>
          </div>
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
