/**
 * Global symbol blacklist — applied to BOTH bots (spot coin bot + futures bot).
 *
 * A per-user `symbol_blocklist` already exists in bot_config / coin_bot_config
 * for user-specific opt-outs. This file is the platform-wide list for symbols
 * we never want any user to trade, regardless of config — usually because
 * historical performance has been consistently bad, the pair is thinly traded,
 * or CoinDCX metadata mislabels its tradability.
 *
 * Symbols must be uppercase and match the ticker feed format ("B-<BASE>_USDT").
 * Both scanners check membership case-insensitively.
 */
export const GLOBAL_SYMBOL_BLACKLIST: ReadonlySet<string> = new Set([
  "B-NFP_USDT",
]);

export function isGloballyBlacklisted(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return GLOBAL_SYMBOL_BLACKLIST.has(symbol.toUpperCase());
}
