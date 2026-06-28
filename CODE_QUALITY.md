# EarnO — Code Quality Analysis

_Baseline snapshot to guide cleanup and refactoring. Generated 2026-06-28._

This is a TanStack Start + React 19 + Supabase crypto-trading intelligence app
(~24,700 LOC excluding shadcn `components/ui/*` and generated `routeTree.gen.ts`).
The core is financial logic — signal scoring, risk sizing, fee-aware exits,
auto-booking — which raises the bar for correctness and test coverage.

## TL;DR — Health Scorecard

| Dimension | Status | Notes |
|---|---|---|
| Type-checks (`tsc --noEmit`) | ✅ Pass | Clean, `strict: true` |
| ESLint | ❌ 2,823 problems | 2,760 are auto-fixable Prettier formatting; 63 substantive |
| Tests (`vitest`) | ⚠️ 19 pass / 1 file | Only `futures/policy.test.ts`; **~0% coverage of money logic** |
| Build tooling | ✅ Modern | Vite 7, React 19, Bun + npm lockfiles both present |
| Dead code | ⚠️ 624 LOC | 3 unused files in `src/services/` |
| Secrets hygiene | ⚠️ `.env` committed | Only publishable/anon keys today (low risk), but no `.gitignore` guard |

**Top 5 things to fix first** (ordered by ROI):
1. Run `npm run format` (Prettier) — clears 2,760 of 2,823 lint errors in one commit.
2. Delete the 3 dead `src/services/*` files (624 LOC of unmaintained duplicates).
3. Add tests for the money math (PnL, fees, position sizing, exits) — currently untested.
4. Fix the silent `catch {}` blocks that swallow API/market-data failures.
5. Centralize magic numbers (trading thresholds) into config/constants.

---

## 1. Tooling Results (verified)

### Formatting dominates the lint noise
`eslint .` reports **2,823 problems**, but the breakdown shows most are cosmetic:

| Rule | Count | Nature |
|---|---|---|
| `prettier/prettier` | 2,760 | Auto-fixable formatting (the repo was never run through Prettier) |
| `@typescript-eslint/no-explicit-any` | 39 | Real type-safety gaps |
| `react-refresh/only-export-components` | 6 | shadcn `ui/*` files (low priority) |
| `no-empty` | 6 | Empty `catch {}` blocks — swallowed errors |
| `@typescript-eslint/no-unused-expressions` | 6 | Comma-operator assignments (work, but ugly) |
| `react-hooks/exhaustive-deps` | 3 | Potential stale-closure / re-render bugs |
| `no-useless-escape` | 2 | Regex cleanup |
| `react-hooks/rules-of-hooks` | 1 | **Real risk** (see below) |

> **Action:** `npm run format && npm run lint -- --fix` brings the count from 2,823 to ~50.
> Do this as an isolated commit so it doesn't pollute future diffs. Consider a CI check
> or pre-commit hook so formatting never drifts again.

### Tests: the riskiest code is the least tested
- One test file: `src/lib/futures/__tests__/policy.test.ts` (19 tests, covering setup
  classification + strategy policy routing).
- **No tests** for: `auto-book.server.ts` (entry gating, position sizing, exit mechanics),
  fee calculations, PnL math, `risk-engine.ts` sizing, `movers`/`signal-scoring` scoring,
  or the recommendation auto-tuner. A single arithmetic error in these paths mis-prices
  positions for every user, and only manual testing would catch it.

---

## 2. Architecture & Structural Issues

### 2.1 Dead / duplicated modules (High — easy win)
Three files in `src/services/` have **zero importers** and appear to be superseded by
`src/lib/` equivalents:

| Dead file | LOC | Superseded by |
|---|---|---|
| `src/services/riskEngine.ts` | 178 | `src/lib/risk-engine.ts` |
| `src/services/scalpScorer.ts` | 251 | `src/lib/signal-scoring.server.ts` |
| `src/services/paperTradingEngine.ts` | 195 | inlined into `auto-book.server.ts` |

These are a maintenance trap: they read like live code but drift silently.
`src/services/coindcxPublicApi.ts` **is** used (keep it).
`src/lib/futures-exit-policy.ts` is an intentional re-export shim (fine — leave it).

> **Action:** delete the three files above.

### 2.2 God-files (High)
Several route/components mix data-fetching, state, business logic, and UI in one unit:

| File | LOC | Problem |
|---|---|---|
| `src/lib/beta-report.functions.ts` | 1,783 | One giant analytics module; many local helpers |
| `src/lib/auto-book.server.ts` | 1,657 | `runAutoBookPass` alone spans ~820 lines / 150+ branches |
| `src/routes/_authenticated/settings.tsx` | 1,383 | Credentials + config + funding + forms in one component |
| `src/routes/_authenticated/index.tsx` | 1,058 | Dashboard + realtime subs + modals + risk calc |
| `src/routes/_authenticated/positions.tsx` | 927 | Spot/futures branching + editors + charts inline |
| `src/lib/movers.functions.ts` | 977 | Fetch + parse + score + book in one file |

> **Action:** extract pure, testable sub-functions from `auto-book` (sizing, fee calc,
> exit decisions) and split route god-components into section components + custom hooks
> (e.g. `useOpenPositions`, query-key factories).

### 2.3 Duplicated logic
- **Fee math appears ~3×**: canonical `fees.ts:computeFees()`, plus inline copies in
  `auto-book.server.ts` (pre-entry and exit paths). Changing the fee model means editing
  three places.
- **Mode/most-common helpers** (`topMode`) re-implemented in both
  `recommendations.functions.ts` and `beta-report.functions.ts`.
- **Currency formatting**: `coin-bot.tsx` defines a local `fmt()` instead of using the
  shared `useCurrency` hook.

---

## 3. Correctness & Robustness

### 3.1 Silent error swallowing (High)
Empty `catch {}` / `.catch(() => {})` blocks hide failures and make production debugging
nearly impossible. Two categories:

- **Market-data fetches** (serious): `movers.functions.ts:119,661,956,975`,
  `signal-scoring.server.ts:51`, `coin-bot/coin-scan.server.ts:51,119`,
  `auto-book.server.ts` (atr/regime/equity fetchers). A network/parse failure silently
  returns `null`/defaults, so the bot can score and trade on missing or stale data with
  no signal that anything went wrong.
- **localStorage writes** (minor): `use-theme.ts:31`, `use-currency.ts:47`,
  `use-market-mode.ts:17`, `use-strictness.ts:25`. Acceptable to swallow, but at least
  `console.warn` so "my settings don't persist" is diagnosable.

> **Action:** for data fetches, log the error and surface a degraded-state flag; never let
> a fetch failure look identical to "no data."

### 3.2 Untrusted external data is cast, not validated (High)
CoinDCX responses are brought in with `as any` / `as Type[]` casts rather than runtime
validation (`movers.functions.ts:115`, `signal-scoring.server.ts:48`,
`coindcxPublicApi.ts:142`, `auto-book.server.ts:49`). A TypeScript cast guarantees nothing
at runtime — a shape change or a `"abc"` where a number is expected gets coerced to `0`
via the `num()` helper and silently poisons price history / indicators. Zod is already a
dependency and is used for some inputs; extend it to candle/ticker parsing.

### 3.3 `any` proliferation (Medium)
39 `no-explicit-any` hits, concentrated in the coin-bot feature
(`routes/_authenticated/coin-bot.tsx` ~11, `components/coin-bot/*`, `coin-bot.functions.ts`).
API responses are typed `any[]`, erasing type-narrowing and letting contract drift through
to runtime. Type the scan/signal responses with discriminated unions.

### 3.4 React hooks issues (Medium)
- **`exit-replay.tsx:14`** — `useRouter()` called inside the `errorComponent` callback
  (`react-hooks/rules-of-hooks`). Works today because TanStack renders it as a component,
  but it's fragile; promote it to a named `function ErrorView()` component.
- **`exhaustive-deps`** in `positions.tsx:139`, `scanner.tsx:73`, `positions-strip.tsx:49`
  — values derived inside render feed `useMemo`/effect deps and can change identity every
  render, risking re-subscriptions and stale closures on Supabase channels.

### 3.5 Numeric edge cases in money math (Medium/High — and untested)
Flagged for review (no tests guard these):
- Division paths in exit PnL (`remainingShare = runnerQty / qty`) with no `qty > 0` guard.
- Position sizing depends on `slPct > 0`, but upstream `price`/`qty` aren't validated `> 0`
  before a signal is recorded.
- Leverage clamped low (`Math.max(1, …)`) but not to the exchange's upper bound.
- Float comparisons against thresholds (e.g. R:R, fade %) without epsilon tolerance.

> **Action:** add a focused unit-test suite around these calculations first — they're pure
> and high-value — before refactoring.

---

## 4. Configuration & Magic Numbers (Medium)

Trading thresholds are hardcoded and scattered across `movers.functions.ts`,
`signal-scoring.server.ts`, `auto-book.server.ts`, and `recommendations.functions.ts`
(RSI bounds, regime EMA thresholds `0.04/0.01/0.012`, hard-SL ROE `-4.5%`, runner-protection
giveback ladders, fade thresholds, min-volume floors, fee/slippage defaults). Consequences:
- Tuning a parameter requires a code deploy; A/B testing is impractical.
- The same concept (e.g. "min trades for a verdict = 20") is duplicated in multiple files
  and can fall out of sync.

> **Action:** consolidate into a single `lib/trading-constants.ts` (or DB-backed config),
> with a comment on each value's rationale.

---

## 5. Security & Secrets Hygiene (Low today, but fix the guard)

- `.env` **is committed to git** and `.gitignore` does **not** list it. The committed keys
  are Supabase *publishable/anon* keys, which are designed to be public and protected by
  Row-Level Security — so there is **no leak of a privileged secret today**. The risk is
  procedural: the moment anyone adds a `SERVICE_ROLE` key or third-party secret to that
  file, it gets committed by default.

> **Action:** add `.env` to `.gitignore`, keep a committed `.env.example` with key *names*
> only, and confirm RLS is enforced on all Supabase tables. (Removing `.env` from history
> is optional given the keys are public, but stop tracking it going forward.)

---

## 6. Suggested Sequence

1. **Formatting/lint baseline** — `npm run format`, `eslint --fix`, add CI guard. _(1 commit, mechanical)_
2. **Delete dead `services/*` files** + de-dupe fee math into `fees.ts`. _(low risk)_
3. **Stop tracking `.env`**, add `.gitignore` entry + `.env.example`.
4. **Test the money math** — pure-function unit tests for sizing, fees, PnL, exit decisions.
5. **Harden data ingestion** — Zod-validate API responses, replace empty `catch {}` with
   logged degraded-state handling.
6. **Centralize trading constants.**
7. **Decompose god-files** — extract pure logic from `auto-book.server.ts`; split the
   largest route components into sections + hooks.

Items 1–3 are safe mechanical wins. 4–5 are the highest-value correctness work given this
app moves toward live trading. 6–7 are larger refactors best done once tests exist.
