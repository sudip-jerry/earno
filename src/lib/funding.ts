// CoinDCX-native funding proxy.
//
// CoinDCX charges perpetual funding (Interest Rate + Premium/Discount, every 8h)
// computed from its own mark price and premium index, but it does NOT expose a
// funding-rate value through its public API. Rather than borrow another
// exchange's funding (which is a different number — different premium, index and
// caps — and is missing for the CoinDCX-only long-tail alts), we reconstruct the
// funding DIRECTION signal from data CoinDCX does expose: the perp's price vs its
// own spot price.
//
//   premium% = (perp - spot) / spot * 100
//
// Positive => perp trades above spot => longs pay funding (crowded longs).
// Negative => perp below spot => shorts pay (crowded shorts).
//
// This is the instantaneous premium, not the settled 8h rate — a fresher,
// 100%-CoinDCX-coverage positioning signal, which is exactly how a ranking model
// uses funding.

/** Perp-vs-spot premium in percent, or null when either price is unusable. */
export function premiumPct(perpPrice: number, spotPrice: number): number | null {
  if (!(perpPrice > 0) || !(spotPrice > 0)) return null;
  return ((perpPrice - spotPrice) / spotPrice) * 100;
}
