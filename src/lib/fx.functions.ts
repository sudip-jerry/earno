import { createServerFn } from "@tanstack/react-start";

export type FxRates = Record<string, number>; // USDT -> ccy rate

const STATIC_FALLBACK: FxRates = {
  USD: 1,
  INR: 104, // USDT/INR on Indian exchanges
  EUR: 0.92,
  GBP: 0.78,
  AED: 3.67,
  SGD: 1.34,
  JPY: 156,
};

type FxSource = "coindcx" | "frankfurter" | "static";

async function fetchCoindcxUsdtInr(): Promise<number | null> {
  try {
    const res = await fetch("https://api.coindcx.com/exchange/ticker", { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as Array<{ market?: string; last_price?: string | number }>;
    const row = Array.isArray(j) ? j.find((r) => r?.market === "USDTINR") : null;
    const px = row ? Number(row.last_price) : NaN;
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

async function fetchFrankfurter(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?from=USD&to=INR,EUR,GBP,AED,SGD,JPY",
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { rates?: Record<string, number> };
    return j.rates ?? null;
  } catch {
    return null;
  }
}

export const getFxRates = createServerFn({ method: "GET" }).handler(async () => {
  const fetchedAt = new Date().toISOString();

  // Pull non-INR rates from Frankfurter (USD-based; USDT≈USD for these).
  const frank = await fetchFrankfurter();

  // Primary INR source: CoinDCX USDT/INR.
  const cdxInr = await fetchCoindcxUsdtInr();

  if (cdxInr != null) {
    const rates: FxRates = { ...STATIC_FALLBACK, ...(frank ?? {}), USD: 1, INR: cdxInr };
    return {
      ok: true as const,
      rates,
      fetchedAt,
      source: "coindcx" as FxSource,
    };
  }

  if (frank) {
    const inr = frank.INR != null ? frank.INR * 1.015 : STATIC_FALLBACK.INR;
    const rates: FxRates = { ...STATIC_FALLBACK, ...frank, USD: 1, INR: inr };
    return {
      ok: true as const,
      rates,
      fetchedAt,
      source: "frankfurter" as FxSource,
    };
  }

  return {
    ok: true as const,
    rates: STATIC_FALLBACK,
    fetchedAt,
    fallback: true,
    source: "static" as FxSource,
  };
});
