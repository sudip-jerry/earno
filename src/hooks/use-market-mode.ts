import { useCallback, useEffect, useState } from "react";

export type MarketMode = "all" | "futures" | "spot";
const KEY = "earno_market_mode";
const EVT = "earno-market-mode-change";

export function getStoredMarketMode(): MarketMode {
  if (typeof window === "undefined") return "all";
  const v = window.localStorage.getItem(KEY);
  return v === "spot" || v === "futures" || v === "all" ? v : "all";
}

export function useMarketMode() {
  const [market, setState] = useState<MarketMode>(() => getStoredMarketMode());

  useEffect(() => {
    try { window.localStorage.setItem(KEY, market); } catch {}
    window.dispatchEvent(new CustomEvent(EVT, { detail: market }));
  }, [market]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && (e.newValue === "spot" || e.newValue === "futures" || e.newValue === "all")) setState(e.newValue as MarketMode);
    };
    const onCustom = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v === "spot" || v === "futures" || v === "all") setState(v as MarketMode);
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
