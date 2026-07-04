import { Link } from "@tanstack/react-router";
import { Home as HomeIcon, LineChart, Settings as Cog } from "lucide-react";

export function SimpleTabBar({ onDetails }: { onDetails: () => void }) {
  return (
    <nav aria-label="Simple primary" className="fixed bottom-5 inset-x-0 z-40 pointer-events-none px-6">
      <div className="mx-auto grid h-[78px] max-w-[330px] grid-cols-3 rounded-full border bg-card/95 shadow-lg backdrop-blur pointer-events-auto">
        <Link to="/" className="flex flex-col items-center justify-center gap-1 text-primary">
          <HomeIcon className="size-6" />
          <span className="text-[16px] font-semibold leading-none">Home</span>
        </Link>
        <button
          type="button"
          onClick={onDetails}
          className="flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition"
          aria-label="Open detailed view"
        >
          <LineChart className="size-6" />
          <span className="text-[16px] font-semibold leading-none">Details</span>
        </button>
        <Link to="/settings" className="flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition">
          <Cog className="size-6" />
          <span className="text-[16px] font-semibold leading-none">Settings</span>
        </Link>
      </div>
    </nav>
  );
}
