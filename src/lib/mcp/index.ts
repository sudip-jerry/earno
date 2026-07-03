import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getDashboardStats from "./tools/get-dashboard-stats";
import listRecentTrades from "./tools/list-recent-trades";
import getCoinHoldings from "./tools/get-coin-holdings";

// The OAuth issuer MUST be the direct Supabase host (RFC 8414 issuer match).
// VITE_SUPABASE_PROJECT_ID is inlined at build time by Vite; the fallback keeps
// the URL well-formed during throwaway manifest-extract evals.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "earno-mcp",
  title: "Earn'O",
  version: "0.1.0",
  instructions:
    "Read-only tools to inspect the signed-in user's Earn'O trading data: dashboard stats, recent futures trades, and open coin holdings.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getDashboardStats, listRecentTrades, getCoinHoldings],
});
