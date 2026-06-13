## Change

Make every position's "Close" button a **limit close at the current price** (CoinDCX limit fees are lower than market). Today the button calls a single `closeManualTrade` server fn that just exits at whatever `mark_price` is in the DB. We'll make it explicit and accurate.

## What you'll see on each position card

- Button label: **Close · Limit @ {live LTP}** (uses the same 3s ticker price the card already shows).
- Disabled state when we have no live price yet, with helper text "Waiting for live price…".
- Confirm dialog: "Place LIMIT close for {side} {symbol} at {price}? (Lower fee than market.)"
- After close, the trade log entry reads "Manually closed via LIMIT at {price}".

## Behind the scenes

1. `closeManualTrade` (in `src/lib/movers.functions.ts`) gains an optional `limitPrice: number` input.
   - Paper mode: uses `limitPrice` as the exit price for the PNL calc instead of falling back to `mark_price`.
   - Live mode hook-up later: the same value is what we'll submit as `price` on a CoinDCX `limit_order` POST. Log message + `exit_reason` change to `manual_limit`.
2. `src/routes/_authenticated/positions.tsx`:
   - Pass the current live price from `useLivePrices` (already wired) into the close mutation.
   - Update the button JSX, disabled-when-no-price logic, and confirm copy as above.
   - Show the live limit price in a small caption under the button.

No DB schema changes. Market-order close is removed entirely — every manual close is a limit at current LTP.

## Files

- Edit `src/lib/movers.functions.ts` — extend `closeSchema` with `limitPrice`, use it in the handler, update the `bot_events` log message and `exit_reason`.
- Edit `src/routes/_authenticated/positions.tsx` — pass live price, relabel button, update confirm dialog, gate on price availability.
