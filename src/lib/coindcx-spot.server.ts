/**
 * Read-only CoinDCX spot price source, used to reconstruct a funding/premium
 * signal for the perpetuals (CoinDCX does not expose a funding-rate value via
 * its public API — see funding.ts).
 *
 * - One bulk call returns every spot market; cached in-memory for 30s with
 *   in-flight dedup, so concurrent lookups in a pass share a single request.
 * - Never used for execution (execution stays on the user's CoinDCX account).
 * - Silent-fail: returns an empty map on any error, warns at most once per
 *   cache window.
 *
 * The endpoint + response shape (`{ market, last_price }`) is the same one
 * already consumed by movers.functions.ts / fx.functions.ts.
 */

const SPOT_TICKER_URL = "https://api.coindcx.com/exchange/ticker";
const SPOT_TTL_MS = 30_000;

type SpotRow = { market?: string; last_price?: string | number };

let cache: { at: number; data: Map<string, number> } | null = null;
let inflight: Promise<Map<string, number>> | null = null;
let warned = false;

function num(x: unknown): number {
  const n = typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : NaN;
}

/** Map of spot market symbol (e.g. "BTCUSDT") → last price. Cached 30s. */
export async function fetchSpotPrices(): Promise<Map<string, number>> {
  const now = Date.now();
  if (cache && now - cache.at < SPOT_TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(SPOT_TICKER_URL, {
        signal: AbortSignal.timeout(3000),
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as SpotRow[];
      const map = new Map<string, number>();
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (!r || typeof r.market !== "string") continue;
          const px = num(r.last_price);
          if (Number.isFinite(px) && px > 0) map.set(r.market, px);
        }
      }
      cache = { at: Date.now(), data: map };
      warned = false;
      return map;
    } catch (e) {
      if (!warned) {
        warned = true;
        console.warn("[coindcx-spot] ticker fetch failed:", e instanceof Error ? e.message : e);
      }
      const empty = new Map<string, number>();
      cache = { at: Date.now(), data: empty };
      return empty;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
