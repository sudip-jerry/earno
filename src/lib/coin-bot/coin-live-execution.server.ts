/**
 * Coin (Spot) LIVE execution helpers.
 * Isolated from futures execution. Only place that touches real CoinDCX spot orders.
 * Paper mode never imports this file.
 */

import { coindcxAuthedPost } from "@/lib/coindcx.server";

export type CoinLiveCreds = { api_key: string; api_secret: string };

export type CoinLiveOrderResult =
  | { ok: true; orderId: string; raw?: unknown }
  | { ok: false; error: string };

type CoindcxSpotOrderResponse = {
  orders?: Array<{ id?: string; client_order_id?: string }>;
  id?: string;
  client_order_id?: string;
};

function extractOrderId(raw: CoindcxSpotOrderResponse): string | null {
  if (raw.orders?.[0]?.id) return String(raw.orders[0].id);
  if (raw.orders?.[0]?.client_order_id) return String(raw.orders[0].client_order_id);
  if (raw.id) return String(raw.id);
  if (raw.client_order_id) return String(raw.client_order_id);
  return null;
}

/**
 * Place a market spot BUY order on CoinDCX.
 * pair: e.g. "BTCUSDT" (CoinDCX spot pair, not futures B-BTC_USDT)
 * totalQuantity: quantity of the base asset to buy
 */
export async function placeCoinLiveBuy(args: {
  creds: CoinLiveCreds;
  pair: string;
  totalQuantity: number;
}): Promise<CoinLiveOrderResult> {
  const { creds, pair, totalQuantity } = args;
  if (totalQuantity <= 0) return { ok: false, error: "quantity must be > 0" };

  const r = await coindcxAuthedPost<CoindcxSpotOrderResponse>(
    "/exchange/v1/orders/create",
    creds.api_key,
    creds.api_secret,
    {
      market: pair,
      side: "buy",
      order_type: "market_order",
      total_quantity: totalQuantity,
      client_order_id: `earno-coin-buy-${Date.now()}`,
    },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const id = extractOrderId(r.data);
  if (!id) return { ok: false, error: "Exchange accepted order but returned no id" };
  return { ok: true, orderId: id, raw: r.data };
}

/**
 * Place a market spot SELL order on CoinDCX.
 * totalQuantity: quantity of the base asset to sell (all holdings)
 */
export async function placeCoinLiveSell(args: {
  creds: CoinLiveCreds;
  pair: string;
  totalQuantity: number;
}): Promise<CoinLiveOrderResult> {
  const { creds, pair, totalQuantity } = args;
  if (totalQuantity <= 0) return { ok: false, error: "quantity must be > 0" };

  const r = await coindcxAuthedPost<CoindcxSpotOrderResponse>(
    "/exchange/v1/orders/create",
    creds.api_key,
    creds.api_secret,
    {
      market: pair,
      side: "sell",
      order_type: "market_order",
      total_quantity: totalQuantity,
      client_order_id: `earno-coin-sell-${Date.now()}`,
    },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const id = extractOrderId(r.data);
  if (!id) return { ok: false, error: "Exchange accepted sell but returned no id" };
  return { ok: true, orderId: id, raw: r.data };
}

/**
 * Convert EarnO futures symbol to CoinDCX spot pair.
 * B-BTC_USDT → BTCUSDT
 */
export function toSpotPair(symbol: string): string {
  return symbol.replace(/^B-/, "").replace("_", "");
}

/**
 * Load coin live credentials from DB.
 * Same api_credentials table as futures — same key works for both.
 */
export async function loadCoinLiveCreds(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
): Promise<CoinLiveCreds | null> {
  const { data } = await supabase
    .from("api_credentials")
    .select("api_key,api_secret")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.api_key || !data?.api_secret) return null;
  return { api_key: data.api_key as string, api_secret: data.api_secret as string };
}
