/**
 * Symbol format converters between exchanges.
 *
 * CoinDCX futures symbols look like "B-NTRN_USDT"; Binance uses "NTRNUSDT".
 * Used only for read-only signal enrichment — execution stays on CoinDCX.
 */

export function mapToBinanceSymbol(coindcxSymbol: string): string | null {
  if (!coindcxSymbol || typeof coindcxSymbol !== "string") return null;
  const m = /^B-([A-Z0-9]+)_([A-Z0-9]+)$/.exec(coindcxSymbol);
  if (!m) return null;
  return `${m[1]}${m[2]}`;
}
