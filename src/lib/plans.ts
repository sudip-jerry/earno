// Client-safe plan metadata. Do NOT import server-only modules here.

export type PlanTier = "free" | "reco" | "auto5" | "unlimited";

export const PLAN_PRICE_INR: Record<PlanTier, number> = {
  free: 0,
  reco: 99,
  auto5: 499,
  unlimited: 999,
};

export const PLAN_NAME: Record<PlanTier, string> = {
  free: "Free",
  reco: "Insights",
  auto5: "Auto-Trader",
  unlimited: "Unlimited",
};

export const PLAN_TAGLINE: Record<PlanTier, string> = {
  free: "Look around. No automation.",
  reco: "Daily recommendations & live scanner.",
  auto5: "Up to 5 auto-booked trades / day.",
  unlimited: "Unlimited auto + manual trades.",
};

export const PLAN_FEATURES: Record<PlanTier, string[]> = {
  free: ["Browse market scanner", "View live opportunities (read-only)"],
  reco: ["Daily curated recommendations", "Live opportunity scanner", "Watchlist & alerts"],
  auto5: [
    "Everything in Insights",
    "Auto-book up to 5 trades per day",
    "Paper trading & manual booking",
  ],
  unlimited: [
    "Everything in Auto-Trader",
    "Unlimited auto-bookings",
    "Unlimited manual trades",
    "Priority support",
  ],
};

export const TIER_ALLOWS_AUTOBOOK: Record<PlanTier, boolean> = {
  free: false,
  reco: false,
  auto5: true,
  unlimited: true,
};

export const TIER_DAILY_LIMIT: Record<PlanTier, number> = {
  free: 0,
  reco: 0,
  auto5: 5,
  unlimited: 9999,
};
