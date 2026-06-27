/**
 * Backward-compatibility re-export. The Futures exit policy now lives in
 * `src/lib/futures/exit-policy.ts` so all backend strategy modules share
 * one folder. Existing callers (replay, mark-pass) keep working through
 * this shim.
 */
export {
  evaluateFuturesExit,
  resolveProfile,
  normaliseStrategy,
  normaliseStyle,
} from "@/lib/futures/exit-policy";
export type {
  ExitDecision,
  FuturesExitConfig,
  FuturesExitTradeState,
  StrategyKind,
  StyleKind,
} from "@/lib/futures/exit-policy";
