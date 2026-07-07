import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type FxRates = Record<string, number>; // USDT -> ccy rate

// USDT/INR trades at a premium to fiat USD/INR on Indian exchanges.
const STATIC_FALLBACK: FxRates = {
  USD: 1,
  INR: 99,
  EUR: 0.92,
  GBP: 0.78,
  AED: 3.67,
  SGD: 1.34,
  JPY: 156,
};

const SUPPORTED = Object.keys(STATIC_FALLBACK);

// If DB row is older than this, we try a live refresh inline as a safety
// net. The primary refresh path is the cron endpoint below.
const DB_STALE_MS = 30 * 60 * 1000;

type FxSource = "db" | "coindcx" | "frankfurter-premium" | "static";

function serverPublic() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

async function readFromDb(): Promise<{
  rates: FxRates;
  fetchedAt: string;
  freshest: number;
} | null> {
  try {
    const sb = serverPublic();
    const { data, error } = await sb.from("fx_rates").select("currency, rate, fetched_at");
    if (error || !data?.length) return null;
    const rates: FxRates = { ...STATIC_FALLBACK };
    let freshest = 0;
    for (const row of data) {
      const r = Number(row.rate);
      if (Number.isFinite(r) && r > 0) rates[row.currency] = r;
      const t = row.fetched_at ? Date.parse(row.fetched_at as unknown as string) : 0;
      if (t > freshest) freshest = t;
    }
    return { rates, fetchedAt: new Date(freshest || Date.now()).toISOString(), freshest };
  } catch {
    return null;
  }
}

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
    return Number.isFinite(px) && px > 0 ? px : null;
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

/**
 * Fetch live rates from external sources and upsert into public.fx_rates.
 * Used by the cron endpoint and as an inline fallback when the DB row is
 * stale. Returns the resulting rates map.
 */
export async function refreshFxRatesInDb(): Promise<{
  rates: FxRates;
  source: FxSource;
  fetchedAt: string;
}> {
  const fetchedAt = new Date().toISOString();
  const [frank, cdxInr] = await Promise.all([fetchFrankfurter(), fetchCoindcxUsdtInr()]);

  let rates: FxRates;
  let source: FxSource;

  if (cdxInr != null) {
    rates = { ...STATIC_FALLBACK, ...(frank ?? {}), USD: 1, INR: cdxInr };
    source = "coindcx";
  } else if (frank) {
    // ~1.15x USDT premium over fiat USD/INR when CoinDCX is unreachable.
    const inr = frank.INR != null ? frank.INR * 1.15 : STATIC_FALLBACK.INR;
    rates = { ...STATIC_FALLBACK, ...frank, USD: 1, INR: inr };
    source = "frankfurter-premium";
  } else {
    rates = { ...STATIC_FALLBACK };
    source = "static";
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = SUPPORTED.map((ccy) => ({
      currency: ccy,
      rate: rates[ccy],
      source,
      fetched_at: fetchedAt,
    }));
    await supabaseAdmin.from("fx_rates").upsert(rows, { onConflict: "currency" });
  } catch (e) {
    console.warn("[fx] upsert failed:", e instanceof Error ? e.message : e);
  }

  return { rates, source, fetchedAt };
}

export const getFxRates = createServerFn({ method: "GET" }).handler(async () => {
  // 1) DB is the source of truth for every screen.
  const db = await readFromDb();
  if (db && Date.now() - db.freshest < DB_STALE_MS) {
    return { ok: true as const, rates: db.rates, fetchedAt: db.fetchedAt, source: "db" as FxSource };
  }

  // 2) DB is missing or stale — refresh inline and return the fresh values.
  try {
    const fresh = await refreshFxRatesInDb();
    return { ok: true as const, rates: fresh.rates, fetchedAt: fresh.fetchedAt, source: fresh.source };
  } catch {
    // 3) Absolute last resort: return whatever DB had, or static.
    if (db) return { ok: true as const, rates: db.rates, fetchedAt: db.fetchedAt, source: "db" as FxSource };
    return {
      ok: true as const,
      rates: STATIC_FALLBACK,
      fetchedAt: new Date().toISOString(),
      fallback: true,
      source: "static" as FxSource,
    };
  }
});
