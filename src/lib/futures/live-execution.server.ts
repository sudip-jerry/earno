/**
 * Futures LIVE (wallet) execution helpers.
 *
 * Modular and isolated: this file is the ONLY place that talks to the
 * exchange to actually place/close real-money futures orders. Paper-mode
 * simulation logic stays in auto-book.server.ts and never touches this.
 *
 * If the user has no API credentials, or the exchange call fails, the
 * helpers return { ok: false, error } so the caller can:
 *   - on entry: skip booking the trade (no phantom position)
 *   - on exit:  still mark the local position closed, but log the failure
 *
 * NOTE: Trades opened/closed via these helpers are real orders against the
 * user's CoinDCX Futures wallet. Never call from paper-mode code paths.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { coindcxAuthedPost } from "@/lib/coindcx.server";

export type LiveCreds = { api_key: string; api_secret: string };

export type LiveOrderSide = "long" | "short";

export type LiveOrderResult =
  | { ok: true; orderId: string; raw?: unknown }
  | { ok: false; error: string };

/** Load the user's CoinDCX credentials. Returns null when not configured. */
export async function loadLiveCreds(
  supabase: SupabaseClient,
  userId: string,
): Promise<LiveCreds | null> {
  const { data } = await supabase
    .from("api_credentials")
    .select("api_key,api_secret")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.api_key || !data?.api_secret) return null;
  return { api_key: data.api_key as string, api_secret: data.api_secret as string };
}

/** Map our long/short → exchange buy/sell side strings. */
function sideForOpen(side: LiveOrderSide): "buy" | "sell" {
  return side === "long" ? "buy" : "sell";
}
function sideForClose(side: LiveOrderSide): "buy" | "sell" {
  // Closing a long = sell; closing a short = buy.
  return side === "long" ? "sell" : "buy";
}

type CoindcxOrderResponse = {
  orders?: Array<{ id?: string; client_order_id?: string }>;
  id?: string;
  client_order_id?: string;
};

function extractOrderId(raw: CoindcxOrderResponse): string | null {
  if (raw.orders?.[0]?.id) return String(raw.orders[0].id);
  if (raw.orders?.[0]?.client_order_id) return String(raw.orders[0].client_order_id);
  if (raw.id) return String(raw.id);
  if (raw.client_order_id) return String(raw.client_order_id);
  return null;
}

/** Place a market entry order on CoinDCX Futures. */
export async function placeLiveEntry(args: {
  creds: LiveCreds;
  symbol: string; // e.g. "B-BTC_USDT"
  side: LiveOrderSide;
  qty: number; // contract qty
  leverage: number;
}): Promise<LiveOrderResult> {
  const { creds, symbol, side, qty, leverage } = args;
  if (qty <= 0) return { ok: false, error: "qty must be > 0" };

  const order = {
    pair: symbol,
    side: sideForOpen(side),
    order_type: "market_order",
    total_quantity: qty,
    leverage: Math.max(1, Math.round(leverage)),
    notification: "no_notification",
    client_order_id: `earno-entry-${Date.now()}`,
  };

  const r = await coindcxAuthedPost<CoindcxOrderResponse>(
    "/exchange/v1/derivatives/futures/orders/create",
    creds.api_key,
    creds.api_secret,
    { order },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const id = extractOrderId(r.data);
  if (!id) return { ok: false, error: "Exchange accepted order but returned no id" };
  return { ok: true, orderId: id, raw: r.data };
}

/** Place a market exit order to flatten an existing futures position. */
export async function placeLiveExit(args: {
  creds: LiveCreds;
  symbol: string;
  side: LiveOrderSide; // original side; helper inverts internally
  qty: number;
}): Promise<LiveOrderResult> {
  const { creds, symbol, side, qty } = args;
  if (qty <= 0) return { ok: false, error: "qty must be > 0" };

  const order = {
    pair: symbol,
    side: sideForClose(side),
    order_type: "market_order",
    total_quantity: qty,
    reduce_only: true,
    notification: "no_notification",
    client_order_id: `earno-exit-${Date.now()}`,
  };

  const r = await coindcxAuthedPost<CoindcxOrderResponse>(
    "/exchange/v1/derivatives/futures/orders/create",
    creds.api_key,
    creds.api_secret,
    { order },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const id = extractOrderId(r.data);
  if (!id) return { ok: false, error: "Exchange accepted exit but returned no id" };
  return { ok: true, orderId: id, raw: r.data };
}
