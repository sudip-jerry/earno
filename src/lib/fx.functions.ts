import { createServerFn } from "@tanstack/react-start";

export type FxRates = Record<string, number>; // USDT -> ccy rate

// USDT/INR trades at a premium to fiat USD/INR on Indian exchanges.
// Keep this close to the current CoinDCX spot so a full fallback doesn't
// undershoot by ~15% (fiat USD/INR is ~85, USDT/INR is ~99-105).
const STATIC_FALLBACK: FxRates = {
  USD: 1,
  INR: 99,
  EUR: 0.92,
  GBP: 0.78,
  AED: 3.67,
  SGD: 1.34,
  JPY: 156,
};

type FxSource = "coindcx" | "frankfurter-premium" | "coindcx-cached" | "static";

// In-memory last-known-good USDT/INR from CoinDCX. Survives across
// invocations within the same worker instance so a single failed poll
// doesn't collapse the rate to fiat USD/INR.
let lastCoindcxInr: { value: number; at: number } | null = null;

async function fetchCoindcxUsdtInr(): Promise<number | null> {
  try {
    const res = await fetch("https://api.coindcx.com/exchange/ticker", {
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Array<{ market?: string; last_price?: string | number }>;
    const row = Array.isArray(j) ? j.find((r) => r?.market === "USDTINR") : null;
    const px = row ? Number(row.last_price) : NaN;
    if (Number.isFinite(px) && px > 0) {
      lastCoindcxInr = { value: px, at: Date.now() };
      return px;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchFrankfurter(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?from=USD&to=INR,EUR,GBP,AED,SGD,JPY",
      { cache: "no-store", signal: AbortSignal.timeout(3500) },
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

  // Fire both in parallel; CoinDCX is authoritative for INR.
  const [frank, cdxInr] = await Promise.all([fetchFrankfurter(), fetchCoindcxUsdtInr()]);

  if (cdxInr != null) {
    const rates: FxRates = { ...STATIC_FALLBACK, ...(frank ?? {}), USD: 1, INR: cdxInr };
    return { ok: true as const, rates, fetchedAt, source: "coindcx" as FxSource };
  }

  // CoinDCX unreachable this poll — prefer the last known good USDT/INR
  // (valid for up to 30 min) over Frankfurter's fiat USD/INR, which is
  // ~10-15% below the actual USDT/INR rate.
  if (lastCoindcxInr && Date.now() - lastCoindcxInr.at < 30 * 60 * 1000) {
    const rates: FxRates = {
      ...STATIC_FALLBACK,
      ...(frank ?? {}),
      USD: 1,
      INR: lastCoindcxInr.value,
    };
    return { ok: true as const, rates, fetchedAt, source: "coindcx-cached" as FxSource };
  }

  if (frank) {
    // Approximate the USDT premium (~1.15x fiat USD/INR at the moment).
    // This is a best-effort estimate only; primary source is CoinDCX above.
    const inr = frank.INR != null ? frank.INR * 1.15 : STATIC_FALLBACK.INR;
    const rates: FxRates = { ...STATIC_FALLBACK, ...frank, USD: 1, INR: inr };
    return { ok: true as const, rates, fetchedAt, source: "frankfurter-premium" as FxSource };
  }

  return {
    ok: true as const,
    rates: STATIC_FALLBACK,
    fetchedAt,
    fallback: true,
    source: "static" as FxSource,
  };
});
