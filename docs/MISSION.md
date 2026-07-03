PROJECT: EarnO (earno.lovable.app)

MISSION
Build a beginner-friendly crypto futures intelligence platform that can eventually deliver aggressive but risk-controlled opportunities.

The goal is NOT to build a single magic trading algorithm.

The goal is:

Signal Engine
+
Risk Engine
+
Execution Engine
+
Learning Engine
+
Recommendation Engine

Current phase is paper-trading optimisation.

--------------------------------------------------
CORE PHILOSOPHY
--------------------------------------------------

Do not optimise for maximum trades.

Optimise for:
- Positive expectancy
- Profit factor > 1
- Controlled drawdown
- Protection of open profits
- Automatic adaptation based on results

A profitable system with fewer trades is preferred over many low-quality trades.

--------------------------------------------------
CURRENT ARCHITECTURE
--------------------------------------------------

Signal Layer
- EMA
- VWAP
- RSI
- Confidence scoring
- Market regime detection

Execution Layer
- Paper futures trading
- Long and short positions
- User-specific configs

Risk Layer
- Risk per trade
- Max trades/day
- Symbol cooldown
- Max SL
- Auto-close timers

Exit Layer
- Stop loss
- Take profit
- Move to breakeven
- Trailing stop
- Profit fade exit
- Time exit

Learning Layer
- Recommendation engine
- Config audit history
- Trade analytics

--------------------------------------------------
TRADING STYLES
--------------------------------------------------

Three styles: Conservative, Balanced, Aggressive.

They differ in risk appetite, timeframe, trade frequency, and exit aggressiveness.

IMPORTANT:
Do NOT hardcode styles in logic.

All behaviour must derive from config fields (style, timeframe, risk, thresholds, cooldowns, exit parameters).

--------------------------------------------------
KNOWN FAILURE MODES
--------------------------------------------------

1. Profit given back.
Trades reach positive ROE, no protection triggers, later close at full SL.

2. Regime-direction mismatch.
Entries taken against higher-timeframe or market regime. Direction performance can invert over time.

3. Fees destroying edge.
Gross PnL near breakeven becomes net loss. Trade quality matters more than quantity. All judgments must be net of fees.

4. Repeated symbol damage.
Certain symbols repeatedly lose. Requires symbol memory and cooldowns.

5. Uncalibrated inputs.
Any gate using a score as probability must be validated against realized outcomes.

--------------------------------------------------
PROFIT PROTECTION
--------------------------------------------------

Implemented capabilities:
- Move SL to breakeven
- TP1 partial-profit logic
- Trailing on the runner
- Profit fade exits
- Profit protection exits
- Breakeven exits
- Protection state tracking

--------------------------------------------------
CURRENT FOCUS
--------------------------------------------------

Exit logic is significantly improved.

Bottleneck is ENTRY QUALITY:
- Signal calibration
- Regime x direction filtering
- Symbol selection
- Trade frequency
- Fee efficiency

--------------------------------------------------
RECOMMENDED NEXT EVOLUTION
--------------------------------------------------

Do NOT keep rewriting one algorithm.

Move toward:

Multiple Strategies
+
Shared Risk Engine

Prerequisite: signal-replay engine for validation before consuming live paper days.

Potential strategy library:

1. VWAP + EMA Pullback
2. Supertrend Trend Following
3. Bollinger Mean Reversion
4. Breakout + Volume Spike

EarnO should eventually become:

Strategy Orchestrator
+
Risk Manager
+
Execution Platform

--------------------------------------------------
WHAT SHOULD NOT BE ADDED
--------------------------------------------------

Avoid:
- Hardcoded groups or styles
- User-specific logic
- Constant manual config tweaking
- Massive schema bloat
- Multiple overlapping exit systems
- Rewriting core strategy every day
- Config values or dated findings in this document

--------------------------------------------------
SUCCESS METRICS
--------------------------------------------------

Track:

- Net PnL (fee- and slippage-adjusted)
- Gross PnL
- Fees
- Profit Factor
- Win Rate
- Long vs Short performance
- Symbol performance
- Exit reason distribution
- SL after BE count
- SL after TP1 count
- Protected trade count
- Recommendation accuracy

Exit protection is successful when:
SL-after-BE = 0
SL-after-TP1 = 0
and net PnL is not persistently negative.

Focus then moves to entry quality.

--------------------------------------------------
IMPORTANT PRINCIPLE
--------------------------------------------------

Do not optimise for today's trades.

Optimise for a framework that learns from thousands of trades and automatically converges toward better configurations over time.

Findings are dated and versioned separately; this document stays timeless.