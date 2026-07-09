/**
 * Symbol format converters.
 *
 * CoinDCX futures symbols look like "B-NTRN_USDT"; the corresponding CoinDCX
 * spot market (from api.coindcx.com/exchange/ticker) is "NTRNUSDT". Used only
 * for read-only signal enrichment (perp-vs-spot premium) — execution stays on
 * CoinDCX. (The bare form also happens to match Binance's symbol, if ever
 * needed.)
 */

export function perpToSpotMarket(coindcxSymbol: string): string | null {
  if (!coindcxSymbol || typeof coindcxSymbol !== "string") return null;
  const m = /^B-([A-Z0-9]+)_([A-Z0-9]+)$/.exec(coindcxSymbol);
  if (!m) return null;
  return `${m[1]}${m[2]}`;
}
