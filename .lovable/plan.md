## Fixes

### 1. Default theme = Light
- In `src/hooks/use-theme.ts`, change the initial/fallback theme from `"dark"` to `"light"` (both the localStorage default and the SSR fallback). The user's saved preference still wins on subsequent visits.

### 2. Manual booking on Watchlist & Weak
- In `src/components/opportunity-card.tsx`, enable the **Book Paper Trade** button for any setup with `action === "long" | "short"` regardless of tier — only `avoid` / `wait` disables it.
- Show a small inline note when booking a non-auto tier: *"Manual book — not auto-eligible"*.
- `Why?` modal already explains the gating; no change needed there.

### 3. Configurable strictness + lower default auto threshold
Add a **Strictness** setting in Settings → Trading with three presets:

| Preset | Auto-book confidence | Volume ratio | Pullback distance | RR min |
|---|---|---|---|---|
| Less strict | ≥ 60% | ≥ 1.2× | ≤ 0.5% | ≥ 1.1 |
| Moderate (default) | ≥ 70% | ≥ 1.3× | ≤ 0.35% | ≥ 1.2 |
| Strict | ≥ 80% | ≥ 1.5× | ≤ 0.25% | ≥ 1.3 |

Implementation:
- Add `strictness: "less" | "moderate" | "strict"` to the existing settings store (localStorage-backed, same place theme lives). Default `"moderate"`.
- In `src/lib/movers.functions.ts`, replace the hard-coded thresholds in `classifyTier` / auto-book gating with values read from the strictness preset. Pass the strictness as a parameter on the server fn input (or accept it via `inputValidator`) and forward from the client query.
- In `src/routes/_authenticated/settings.tsx`, add a segmented control: *Less strict (60%) · Moderate (70%) · Strict (80%)* with a short description of what each preset changes.
- Dashboard tier tiles + Scanner re-classify automatically when the preset changes (query key includes `strictness`).

### 4. UI consistency
- "Wait" tier label stays, but tier counts on the dashboard will reflect the new threshold so Auto-Book Eligible is no longer near-zero out of the box.
- No changes to risk engine, order placement, or DB schema.

### Files touched
- `src/hooks/use-theme.ts` — light default
- `src/hooks/use-settings.ts` (new, or extend existing settings hook) — strictness preset
- `src/lib/movers.functions.ts` — read thresholds from preset
- `src/routes/_authenticated/settings.tsx` — strictness control
- `src/routes/_authenticated/index.tsx` + `scanner.tsx` — pass strictness into query
- `src/components/opportunity-card.tsx` — enable manual book on long/short, inline note