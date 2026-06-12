// Server-only CoinDCX REST helpers. Never import from client code.
import { createHmac } from "crypto";

const BASE = "https://api.coindcx.com";

function sign(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export async function coindcxAuthedPost<T = unknown>(
  path: string,
  apiKey: string,
  apiSecret: string,
  payload: Record<string, unknown> = {},
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const body = JSON.stringify({ ...payload, timestamp: Date.now() });
  const signature = sign(apiSecret, body);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-APIKEY": apiKey,
        "X-AUTH-SIGNATURE": signature,
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 300) };
    return { ok: true, data: JSON.parse(text) as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network error" };
  }
}

export async function coindcxPublicGet<T = unknown>(
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
