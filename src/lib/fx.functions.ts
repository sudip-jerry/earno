import { createServerFn } from "@tanstack/react-start";

export type FxRates = Record<string, number>; // USD -> ccy rate

const STATIC_FALLBACK: FxRates = {
  USD: 1,
  INR: 83.5,
  EUR: 0.92,
  GBP: 0.78,
  AED: 3.67,
  SGD: 1.34,
  JPY: 156,
};

export const getFxRates = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?from=USD&to=INR,EUR,GBP,AED,SGD,JPY",
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`fx ${res.status}`);
    const j = (await res.json()) as { rates?: Record<string, number> };
    const rates: FxRates = { USD: 1, ...STATIC_FALLBACK, ...(j.rates ?? {}) };
    return { ok: true as const, rates, fetchedAt: new Date().toISOString() };
  } catch {
    return { ok: true as const, rates: STATIC_FALLBACK, fetchedAt: new Date().toISOString(), fallback: true };
  }
});
