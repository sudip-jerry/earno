import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getFxRates } from "@/lib/fx.functions";

export const CURRENCY_OPTIONS = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "JPY"] as const;
export type CurrencyCode = (typeof CURRENCY_OPTIONS)[number];

export const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "AED ",
  SGD: "S$",
  JPY: "¥",
};

const LS_KEY = "earno_currency";

function readLs(): CurrencyCode {
  if (typeof window === "undefined") return "INR";
  const v = window.localStorage.getItem(LS_KEY);
  return (CURRENCY_OPTIONS as readonly string[]).includes(v ?? "") ? (v as CurrencyCode) : "INR";
}

export function useCurrency() {
  const qc = useQueryClient();
  const fxFn = useServerFn(getFxRates);

  const profile = useQuery({
    queryKey: ["profile_currency"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("currency").maybeSingle();
      if (error) throw error;
      return (data?.currency ?? readLs()) as CurrencyCode;
    },
  });

  const fx = useQuery({
    queryKey: ["fx_rates"],
    queryFn: () => fxFn(),
    refetchInterval: 30 * 60 * 1000,
    staleTime: 25 * 60 * 1000,
  });

  const code: CurrencyCode = profile.data ?? readLs();
  const rate = fx.data?.rates?.[code] ?? 1;
  const symbol = CURRENCY_SYMBOL[code];

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY, code);
    } catch (e) {
      // Non-fatal: localStorage may be unavailable (private mode / quota).
      console.warn("[use-currency] could not persist currency preference:", e);
    }
  }, [code]);

  const mut = useMutation({
    mutationFn: async (next: CurrencyCode) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ currency: next })
        .eq("id", u.user.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(["profile_currency"], next);
    },
  });

  const setCurrency = useCallback((c: CurrencyCode) => mut.mutate(c), [mut]);

  const fmt = useCallback(
    (usd: number | null | undefined, opts?: { signed?: boolean; digits?: number }) => {
      if (usd == null || !Number.isFinite(Number(usd))) return "—";
      const v = Number(usd) * rate;
      const digits =
        opts?.digits ?? (code === "JPY" || code === "INR" ? (Math.abs(v) >= 100 ? 0 : 2) : 2);
      const abs = Math.abs(v).toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits === 0 ? 0 : 2,
      });
      if (opts?.signed) {
        const sign = v >= 0 ? "+" : "−";
        return `${sign}${symbol}${abs}`;
      }
      return `${v < 0 ? "−" : ""}${symbol}${abs}`;
    },
    [rate, symbol, code],
  );

  return {
    code,
    symbol,
    rate,
    fmt,
    setCurrency,
    isUpdating: mut.isPending,
    fxFetchedAt: fx.data?.fetchedAt,
  };
}
