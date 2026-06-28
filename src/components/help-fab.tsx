import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { HelpFlow } from "@/routes/_authenticated/help";
import mascot from "@/assets/earney-wave.png.asset.json";

export function HelpFab() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Hide on the full-page /help route and on auth/terms
  const hide =
    pathname.startsWith("/help") || pathname.startsWith("/auth") || pathname.startsWith("/terms");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (hide) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="How it works"
        className="fixed z-40 bottom-24 right-4 size-16 rounded-full bg-gradient-to-br from-white to-primary/5 dark:from-card dark:to-primary/10 shadow-xl ring-1 ring-primary/20 grid place-items-center hover:scale-110 active:scale-95 transition-transform"
      >
        <img src={mascot.url} alt="Meet Earney" className="size-14 object-contain drop-shadow-sm" />
        <span className="absolute -top-0.5 -right-0.5 size-3.5 rounded-full bg-emerald-500 ring-2 ring-background animate-pulse" />
      </button>
      <div className="fixed z-40 bottom-40 right-4 max-w-[10rem] rounded-2xl rounded-br-sm bg-card px-3 py-2 text-xs font-medium text-foreground shadow-lg ring-1 ring-primary/20 animate-bounce">
        Hi I am earn'O
      </div>

      {open && (
        <div className="fixed inset-0 z-50 animate-fade-in">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 top-8 sm:inset-4 sm:top-auto sm:bottom-4 sm:max-w-md sm:mx-auto rounded-t-2xl sm:rounded-2xl bg-background shadow-2xl overflow-hidden flex flex-col animate-scale-in">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute top-3 right-3 z-10 size-9 grid place-items-center rounded-full hover:bg-muted"
            >
              <X className="size-5" />
            </button>
            <HelpFlow onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
