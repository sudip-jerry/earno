import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLivePrices } from "@/lib/movers.functions";
import { useMemo } from "react";

export function useLivePrices(symbols: string[], enabled = true) {
  const fn = useServerFn(getLivePrices);
  const key = useMemo(() => Array.from(new Set(symbols)).sort(), [symbols]);

  const q = useQuery({
    queryKey: ["live_prices", key],
    queryFn: async () => {
      if (key.length === 0) return { prices: {} as Record<string, number> };
      const res = await fn({ data: { symbols: key } });
      return { prices: res.ok ? res.prices : {} };
    },
    enabled: enabled && key.length > 0,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    staleTime: 2000,
  });

  return { prices: q.data?.prices ?? {}, isFetching: q.isFetching, refetch: q.refetch };
}
