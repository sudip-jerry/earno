import { useEffect, useState, useCallback } from "react";

export type Strictness = "less" | "moderate" | "strict";
const KEY = "earno_strictness";

export function getStoredStrictness(): Strictness {
  if (typeof window === "undefined") return "moderate";
  const v = window.localStorage.getItem(KEY);
  return v === "less" || v === "moderate" || v === "strict" ? v : "moderate";
}

export const STRICTNESS_PRESETS: Record<
  Strictness,
  {
    label: string;
    autoConf: number;
    volRatio: number;
    pullbackMaxPct: number;
    rrMin: number;
    description: string;
  }
> = {
  less: {
    label: "Less strict",
    autoConf: 60,
    volRatio: 1.2,
    pullbackMaxPct: 0.5,
    rrMin: 1.1,
    description: "More setups eligible for auto-book. Higher trade frequency, more noise.",
  },
  moderate: {
    label: "Moderate",
    autoConf: 70,
    volRatio: 1.3,
    pullbackMaxPct: 0.35,
    rrMin: 1.2,
    description: "Balanced. Recommended default.",
  },
  strict: {
    label: "Strict",
    autoConf: 80,
    volRatio: 1.5,
    pullbackMaxPct: 0.25,
    rrMin: 1.3,
    description: "Only the cleanest setups auto-book. Fewer trades, higher quality.",
  },
};

export function useStrictness() {
  const [strictness, setState] = useState<Strictness>(() => getStoredStrictness());

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, strictness);
    } catch {}
    // Notify same-tab listeners
    window.dispatchEvent(new CustomEvent("earno-strictness-change", { detail: strictness }));
  }, [strictness]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === KEY &&
        (e.newValue === "less" || e.newValue === "moderate" || e.newValue === "strict")
      ) {
        setState(e.newValue);
      }
    };
    const onCustom = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v === "less" || v === "moderate" || v === "strict") setState(v);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("earno-strictness-change", onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("earno-strictness-change", onCustom as EventListener);
    };
  }, []);

  const setStrictness = useCallback((s: Strictness) => setState(s), []);
  return { strictness, setStrictness };
}
