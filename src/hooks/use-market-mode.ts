import { useCallback, useEffect, useState } from "react";

export type MarketMode = "futures" | "spot";
const KEY = "earno_market_mode";
const EVT = "earno-market-mode-change";

export function getStoredMarketMode(): MarketMode {
  if (typeof window === "undefined") return "futures";
  const v = window.localStorage.getItem(KEY);
  return v === "spot" || v === "futures" ? v : "futures";
}

export function useMarketMode() {
  const [market, setState] = useState<MarketMode>(() => getStoredMarketMode());

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, market);
    } catch (e) {
      // Non-fatal: localStorage may be unavailable (private mode / quota).
      console.warn("[use-market-mode] could not persist market mode:", e);
    }
    window.dispatchEvent(new CustomEvent(EVT, { detail: market }));
  }, [market]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && (e.newValue === "spot" || e.newValue === "futures"))
        setState(e.newValue);
    };
    const onCustom = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v === "spot" || v === "futures") setState(v);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVT, onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVT, onCustom as EventListener);
    };
  }, []);

  const setMarket = useCallback((m: MarketMode) => setState(m), []);
  return { market, setMarket };
}
