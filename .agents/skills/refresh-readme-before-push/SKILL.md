---
name: refresh-readme-before-push
description: Refresh README.md high-level Algorithm, Architecture, and Features sections before any push, publish, or deploy of the EarnO app. Trigger whenever the user says "push", "publish", "deploy", "ship", "go live", or asks to update README / docs.
---

# Refresh README before push

EarnO's `README.md` documents the trading algorithm, system architecture, and feature surface at a high level. It drifts whenever code changes ship without a doc pass. This skill keeps three specific sections current right before a push.

## When to run

Run BEFORE responding to any of:
- "push", "publish", "deploy", "ship it", "go live", "release"
- "update the readme", "refresh docs", "sync documentation"
- After a meaningful feature/architecture change when offering the publish action

Do not run for trivial copy tweaks, color changes, or single-component edits with no behavior change.

## What to update

Edit ONLY these three sections in `README.md`. Leave everything else (badges, install, license, screenshots) untouched.

1. **High-Level System Architecture** — the ASCII / mermaid diagram + surrounding paragraph. Reflect the current stack: TanStack Start version, server-fn vs server-route split, Supabase usage, scheduler/cron entry points, external APIs (CoinDCX public endpoints), and any new server-only modules under `src/lib/*.server.ts`.
2. **Trading Algorithm (High Level)** — bullet list summarizing: scanner inputs, scoring/confidence rules, risk engine (ATR-based SL, trading-style presets, R:R gating), auto-book eligibility, exit logic (TP/SL/time/trend-invalidated/kill-switch), and paper-vs-live distinction. Pull current numbers/defaults from `src/lib/risk-engine.ts` and `src/lib/auto-book.server.ts`.
3. **Features (High Level)** — short bullets grouped by area: Dashboard, Scanner, Positions (incl. chart sheet), Settings (trading style, risk presets), Auth/Plans, Admin. One line per feature, no marketing copy.

If a section header is missing, create it with the exact title above, placed in this order near the top of the README (after Quick Overview).

## How to gather facts

Before editing, read in this order — stop early if a section is clearly unchanged:

1. `src/lib/risk-engine.ts` — preset names, default `minSL`, `atrMultiplier`, `maxAutoSL`, `targetMultiplier`, `minRR`.
2. `src/lib/auto-book.server.ts` — ATR window, candle interval, auto-book gating, daily plan limits.
3. `src/lib/movers.functions.ts` — scanner data sources and CoinDCX endpoints in use.
4. `src/routes/_authenticated/` — list of user-facing pages → features.
5. `supabase/migrations/` (latest 3-5 files) — schema additions to mention in Architecture.
6. `src/start.ts` — global middleware (e.g. `attachSupabaseAuth`).

Use parallel reads. Do NOT dump full file contents into the README — distill to 1-2 lines per concept.

## Writing rules

- Keep each section under ~25 lines.
- No emojis inside the three managed sections (badges/quick-overview elsewhere may keep theirs).
- No future projections, no "safe", no "guaranteed". Use the existing wording vocabulary: Risk accepted, Risk rejected, Auto-book eligible, Manual review required, Volatility too high, Risk-reward weak.
- Mention paper-trading-by-default explicitly in Features and Algorithm.
- Do NOT reveal secrets, project IDs, Supabase dashboard URLs, or service-role keys.
- Do NOT add a "Last updated" timestamp — it churns diffs unnecessarily.

## Workflow

1. Run the fact-gathering reads in parallel.
2. Diff each managed section mentally against the facts. If a section is already accurate, skip it — do not rewrite for style.
3. Edit `README.md` with targeted line-replace operations on each stale section.
4. After editing, briefly tell the user what changed (one short bullet per updated section) and then proceed with the publish/push action they originally requested.
5. If nothing meaningful changed, say "README already in sync" and proceed with the push.

## Out of scope

- No changes to install instructions, env var lists, license, or contributors.
- No new top-level sections beyond the three above.
- No commits/pushes from the skill itself — git state is managed by the platform.
