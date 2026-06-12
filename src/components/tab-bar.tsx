import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Flame } from "lucide-react";

export function TabBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabs = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard },
    { to: "/movers", label: "Movers", icon: Flame },
  ] as const;

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 inset-x-0 z-30 border-t bg-background/90 backdrop-blur"
    >
      <ul className="grid grid-cols-2 max-w-md mx-auto">
        {tabs.map((t) => {
          const active = pathname === t.to;
          const Icon = t.icon;
          return (
            <li key={t.to}>
              <Link
                to={t.to}
                className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <Icon className={`size-5 ${active ? "" : "opacity-70"}`} />
                <span>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
