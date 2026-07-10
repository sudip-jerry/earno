import { useEffect, useState } from "react";

/**
 * Futures movers are recomputed live on every scan, so they have no persisted
 * created_at like coin signals do. To still show a meaningful, stable age we
 * record when each symbol *first appeared* in the results and persist it in
 * localStorage (so it survives 30s refetches and navigation). Symbols that
 * drop out of the results are pruned, so a later reappearance counts as new
 * and the map stays bounded.
 */
export function useFirstSeen(symbols: string[], ns = "default"): Record<string, number> {
  const KEY = `earno_signal_seen_${ns}`;
  const [map, setMap] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem(KEY) || "{}") as Record<string, number>;
    } catch {
      return {};
    }
  });

  const sig = symbols.join(",");
  useEffect(() => {
    if (symbols.length === 0) return; // don't wipe on loading/empty
    setMap((prev) => {
      const now = Date.now();
      const next: Record<string, number> = {};
      for (const s of symbols) next[s] = prev[s] ?? now;
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / disabled storage */
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return map;
}
