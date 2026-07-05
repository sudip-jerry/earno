/**
 * Read-only Binance Futures public data source for analytics enrichment.
 *
 * - No API key required.
 * - Never used for execution (execution stays on the user's connected CoinDCX).
 * - Every call fails silently: returns null / empty on any error, logs at most
 *   one console.warn per scan pass to avoid log spam.
 */

const PREMIUM_INDEX_URL = "https://fapi.binance.com/fapi/v1/premiumIndex";
const OPEN_INTEREST_URL = "https://fapi.binance.com/fapi/v1/openInterest";
const FUNDING_TTL_MS = 60_000;

type PremiumIndexRow = {
  symbol?: string;
  markPrice?: string | number;
  lastFundingRate?: string | number;
};

export type FundingEntry = { fundingRate: number; markPrice: number };

let cache: { at: number; data: Map<string, FundingEntry> } | null = null;
let inflight: Promise<Map<string, FundingEntry>> | null = null;

// Track whether we've already warned during the current cache window.
let warnedFunding = false;
let warnedOi = false;

function num(x: unknown): number {
  const n = typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : NaN;
}

/** Fetch all funding rates in one call (Binance returns every symbol when
 *  none is supplied). Result is cached in-memory for 60s. */
export async function fetchAllFundingRates(): Promise<Map<string, FundingEntry>> {
  const now = Date.now();
  if (cache && now - cache.at < FUNDING_TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(PREMIUM_INDEX_URL, {
        signal: AbortSignal.timeout(3000),
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as PremiumIndexRow[];
      const map = new Map<string, FundingEntry>();
      if (Array.isArray(raw)) {
        for (const r of raw) {
          if (!r || typeof r.symbol !== "string") continue;
          const fr = num(r.lastFundingRate);
          const mp = num(r.markPrice);
          if (!Number.isFinite(fr) && !Number.isFinite(mp)) continue;
          map.set(r.symbol, {
            fundingRate: Number.isFinite(fr) ? fr : 0,
            markPrice: Number.isFinite(mp) ? mp : 0,
          });
        }
      }
      cache = { at: Date.now(), data: map };
      warnedFunding = false;
      warnedOi = false;
      return map;
    } catch (e) {
      if (!warnedFunding) {
        warnedFunding = true;
        console.warn("[binance-futures] premiumIndex fetch failed:", e instanceof Error ? e.message : e);
      }
      const empty = new Map<string, FundingEntry>();
      cache = { at: Date.now(), data: empty };
      return empty;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Fetch open interest for a single Binance symbol. Silent-fail → null. */
export async function fetchOpenInterest(
  binanceSymbol: string,
): Promise<{ openInterest: number } | null> {
  if (!binanceSymbol) return null;
  try {
    const res = await fetch(
      `${OPEN_INTEREST_URL}?symbol=${encodeURIComponent(binanceSymbol)}`,
      {
        signal: AbortSignal.timeout(3000),
        headers: { accept: "application/json" },
      },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { openInterest?: string | number };
    const oi = num(j?.openInterest);
    if (!Number.isFinite(oi)) return null;
    return { openInterest: oi };
  } catch (e) {
    if (!warnedOi) {
      warnedOi = true;
      console.warn("[binance-futures] openInterest fetch failed:", e instanceof Error ? e.message : e);
    }
    return null;
  }
}
