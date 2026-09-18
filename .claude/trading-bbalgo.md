<!-- Received from Coleman 2026-09-16, mid-session. Status: LOGIC SPEC, NOT WIRED.
     Nothing in this file gates a live order yet. The hook-enforced caps in
     .claude/robinhood-cap.json and the execution guard in tools/guard.py still
     govern every buy. See scans/2026-09-04.md (9/16 midday) for the open blockers. -->

# Coleman's Robinhood Trading Agent — Master Rules File

This is the complete, self-contained ruleset for Coleman's personal swing/momentum trading agent on Robinhood. It sits entirely inside Coleman's self-defined "capped speculation lane" — kept separate from income planning, never factored into any business projection.

Compiled from: Coleman's own stated trading discipline framework, the BBALGO (Bull Bear Algo, spec BBv2.9.1) indicator glossary from the Hot Trades Discord, Hot Trades founder Blaise's own posted trading education, and the 1-minute operational build spec drafted for this agent. Where sources disagree, that's flagged rather than silently resolved — Coleman decides those calls, not the agent.

---

## PART 1 — The 10-Rule Trading Discipline Framework (governs everything below)

Top-level discipline layer. Overrides tactics when the two conflict.

1. **Discipline** — plan every scenario, execute like a robot. Know entry/exit/invalidation before entering. No negotiating mid-trade.
2. **No emotion** — no revenge trades, no bias from past wins or losses.
3. **Master 1–2 systems fully** before adding more.
4. **Read filings/DD before entry** — dilution, warrants, offerings, debt, insider ownership, cash position.
5. **Draw key levels before entry** — support/resistance, supply/demand, fibs.
6. **Keep a trade journal** — why entered/exited, what worked, what failed.
7. **Trade only your best window, then stop screens.**
8. **Don't need every trade to win** — respect daily max loss and stop for the day.
9. **Find a trading tribe.**
10. **Stay humble, keep learning.**

**Note on Rule 7 and the 1-minute decision**: 1-minute bars require near-constant screen attention during the window, which pulls against this rule harder than 5-min or 1-hour would. Coleman chose 1-minute anyway (matches BBALGO's native tuning) — so the trading-window cutoff in Part 5 must be a hard clock-time gate in code, not a judgment call.

---

## PART 2 — BBALGO Confluence System (primary mechanical ruleset, replaced a prior Minervini-style system on 2026-09-16)

### 2.1 Core indicator stack (exact parameters)

| Indicator | Setting |
|---|---|
| Fast trigger EMA ("BLAISER9") | 9-period EMA |
| Trend EMAs | 50 EMA (intermediate), 200 EMA (long-term anchor) |
| Kernel Regression | Rational Quadratic, lookback 12, relative weighting 8, regression level 25 |
| MACD | (4, 18, 7) |
| RSI | length 14 |
| ADX | length 14 |
| Bollinger Bands | 20-period basis, 3.0 stdev |
| ATR | length 14 |
| Relative Volume (RVol) | current bar volume / 20-bar average |
| VWAP | session-anchored, +/-1 and +/-2 SD bands |
| Fibonacci | swing-based; Golden Pocket = 61.8%–65% |
| TD Sequential | 9-count buy/sell setups, "Perfected 9" |
| Pivots | 7 bars left / 10 bars right |
| Order Blocks | sensitivity 20 over 4 bars; up to 15 live zones per side |
| Fair Value Gaps | 3-bar imbalance |

### 2.2 Trend / regime read

- **Uptrend / Downtrend**: ADX-confirmed directional regime.
- **Consolidating**: ADX weak, no directional lead. Signals inside consolidation carry less weight — wait for BOS, ChoCH, or breakout.
- **Kernel state**: `KRNL Bull` = kernel rising AND 3-bar rate of change positive. `KRNL Weak Bull` = rising but unconfirmed. Mirror for bear.
- **Kernel strength %**: smoothed distance between kernel and 9 EMA, 0–100%. High = extended, caution on chasing.
- **Golden/Death Cross**: 50 EMA crossing 200 EMA = long-term regime change.

### 2.3 Momentum read

- **Bullish/Bearish**: MACD above/below signal.
- **Bull+ (triangle up)**: MACD bullish cross AND RSI crosses up through 50 same bar.
- **Bear+ (triangle down)**: MACD bearish cross AND RSI crosses down through 50 same bar.
- **Momentum Scanner** (composite, PLACEHOLDER — see Part 8): >=+3 "Bullish Momentum," <=-3 "Bearish Momentum." Reconstruction: +1 MACD bullish, +1 RSI>50 and rising, +1 RVol >=2x on an up bar (mirror for bearish). Log against BBALGO's actual chart output every session — not backtested.
- **Strengthening/Weakening**: early MACD/RSI disagreement.
- **Possible Reversal**: deeper disagreement (MACD bullish with RSI 30–40, or bearish with RSI 60–70) — watch flag, not an entry.
- **OverBought/OverSold**: MACD agrees with direction AND RSI >=70 / <=30.

### 2.4 Structure read

- **Double Top (T1/T2) / Double Bottom (B1/B2)**: 10-bar pivots; second touch holding confirms.
- **BO (Breakout)**: confirmed close above the double-top level, bar opened higher, no breakout in prior 4 bars.
- **LG (Liquidity Grab)**: sweeps the level then closes back inside — false breakout, fade candidate.
- **BOS (Break of Structure)**: close through last pivot in the SAME direction as bias — continuation.
- **ChoCH (Change of Character)**: close through last pivot AGAINST bias — the trend-flip signal, most important structural event in the system.
- **PDH/PDL**: previous day high/low.

### 2.5 Supply/demand zones

- **Demand Zone**: last down candle before a sharp push up — support until mitigated.
- **Supply Zone**: last up candle before a sharp push down — resistance until mitigated.
- **Mitigation**: close beyond it, a wick touching it, or a close beyond its average midpoint.
- **Bull/Bear FVG**: 3-bar imbalance; price often returns to fill before continuing.

### 2.6 Volume / delta read

- **Cumulative Delta proxy**: `buy_vol ~= volume * (close - low) / (high - low)`, `sell_vol ~= volume * (high - close) / (high - low)`.
- **Delta Spike**: one side >=3x the other.
- **RVol tiers**: 2x, 2.5x, 3x, 3.5x, 4x+.
- **Bullish/Bearish Continuation**: bar pushing in zone direction on >=3x volume.
- **Absorption**: heavy volume eaten at the OPPOSITE zone — often precedes reversal.

### 2.7 Exhaustion (TD Sequential)

- **9-count**: 9 consecutive closes below (buy setup) or above (sell setup) the close 4 bars earlier.
- **Perfected 9**: the 9th bar's low undercuts (or high exceeds) the prior two bars — strongest version.

### 2.8 The 5-step confluence framework (BBALGO's official class)

1. Kernel + 9 EMA — foundation trend/momentum read
2. Order Blocks — reversal entries at demand/supply zones
3. Double Top/Bottom — structure and liquidity context
4. Golden Pocket — fib confluence entry zone
5. Momentum Scanner — final confirmation layer

### 2.9 Entry rules — ONLY act on Tier 3

**Tier 3 ("Bullish/Bearish with Confluence") — the only tradeable tier. ALL required:**
- KRNL Bull/Bear confirmed (not "Weak")
- Price at/inside a Demand/Supply Zone, a pivot, or the Golden Pocket
- A BOS in the trade direction, or a fresh ChoCH that just flipped the trend that way
- RVol >=2x on the signal bar
- Momentum Scanner composite >=+3 long / <=-3 short

**Downweight or skip** any setup firing while ADX flags "Consolidating" — wait for BOS, ChoCH, or breakout.

**Context-only flags** (log, never trade alone, need next-bar confirmation): Possible Reversal, Strengthening/Weakening, Absorption, Rejection for Continuation.

**Carried-over hard rules (not in BBALGO source, kept from prior system):**
- Catalyst required (news/earnings/upgrade/launch) — no catalyst, no trade.
- Regime filter: only take longs while SPY trades above its 200-**day** moving average (daily chart, independent of the intraday timeframe the entry runs on).
- Never chase a stock that already spiked — wait for the retest.

### 2.10 Sizing (BBALGO source has none of this — carried from the prior system)

```
stop_distance = 2 * ATR(14)          # long: close - 2*ATR ; short: close + 2*ATR
risk_dollars  = account_equity * 0.01
shares        = floor(risk_dollars / stop_distance)
```

- No stop set = no trade.
- Scale in 2–3 entries max, only on confirmation (never pyramid down without a pre-planned price).
- Each add gets its own stop; move stop to breakeven once adds are placed.
- Target and stop both set before entry, no exceptions. Never move a stop further away mid-trade.

### 2.11 Exit rules

- **ATR stop**: Long SL = close - 2*ATR(14); Short SL = close + 2*ATR(14).
- **Zone invalidation** as trailing stop: tighten/exit if the entry zone gets mitigated.
- **ChoCH against the position** = strongest exit/flip signal.
- **9-count against the position** = reduce or take partial.
- **Absorption against the position** at the zone being fought = tighten stop, don't add.

---

## PART 3 — Hard Overrides (never break these, no matter what the indicators say)

- No catalyst = no trade.
- No stop set = no trade.
- Never chase a stock that already spiked — wait for retest.
- One trading window, then stop screens.
- Daily max loss hit = done for the day.

---

## PART 4 — Blaise's Discretionary Overlay (layers on top of BBALGO, doesn't replace it)

### 4.1 His core framework (#new-trader-education, 3/17/25)

1. Momentum basics: buy stocks trending up in price AND volume, sell as momentum fades.
2. Start small — never trade full account early.
3. Focus on volatility — high volume plus real price swings, but volatility cuts both ways.
4. Indicators: Bull Bear Algo primary, backed by 50/200-day MAs, RSI, MACD.
5. Set clear rules before every trade: his stated numbers — **target 5–10% gain, stop 2–3% loss.**
6. Stay informed — news, earnings, sector trends, catalysts.
7. Discipline — don't chase a spike, don't hold past target hoping.
8. Paper trade first.
9. Manage risk — proper stops; losses stack fast.
10. Mindset: any single trade's outcome, even from a proven method, is unique and random. Focus on process, without hesitation, reservation, or fear.

**Conflict flag**: Blaise's 5–10% target / 2–3% stop is fixed-percentage sizing. BBALGO's ATR stop (2.10/2.11) is volatility-adaptive. Two different approaches — don't blend silently. If both are active, log which produced which result and let Coleman decide which governs.

### 4.2 His real trade-call language (#options-cooking-lab, live TSLA call)

> "TSLA – Bullish consolidation. We covered this from the $383 bounce, to the $430 breakout trigger, and then the continuation setup... It's consolidating off the 5EMA coming into the week, and the $474 level. As long as this area holds this week, with dips down to the $460 area acceptable to fill the gap below/backtest the 9/20EMAs, looking for continuation higher. The target above remains $500–$530."

Beyond the glossary: he watches the **5 EMA** as a tight consolidation reference (not in BBALGO at all); a **gap-fill / EMA backtest pullback** is a normal continuation setup, not a failure; he trades **specific dollar levels**, not just indicator states.

### 4.3 His actual entry trigger diagram

A 20-period MA under a basing-to-breakout move, left to right:
**Retest** (pullback touches the 20 MA after a base) -> **Entry** (at/near that retest) -> **Momentum Confirmation** (price pushes back through the recent high) -> **Exit** (into the extension).

Distinct from BBALGO's zone/pivot/Golden Pocket entries — buy the pullback that retests the 20 MA, not the breakout candle. Run as an alternate/supplementary entry alongside Tier 3.

### 4.4 Price Action Secrets (5-point checklist before any trade)

1. Check the news
2. Wait for the confirmation
3. Find key support and resistance
4. (partially cut off in source — likely a candle-close/reversal-signal line)
5. Know where to place your stop loss

### 4.5 Candlestick reference — "Bullish Rejection Patterns"

Three Green Soldiers, Bullish Engulfing, Morning Star, Tweezer Bottoms — each marked with Entry and Support. Visual backup to the mechanical signals.

### 4.6 "How to Identify a Down-Trend" (9-panel reference)

Highs & Lows (lower-highs/lower-lows), Fibonacci Levels, Support Levels, Channel Patterns, Flag Patterns, Volume (declining/climactic), Moving Average (price below, sloping down), MA Crossover, Elliott Waves. Confirms downtrends / when to stay out of longs.

### 4.7 Watchlist / risk philosophy

"Build a Watchlist, Don't Blindly Follow Others, Protect Capital."

---

## PART 5 — Operational Build: 1-Minute Scan & Guard-Check Logic

Timeframe decided 2026-09-16: **1-minute bars**, matching BBALGO's native TradingView tuning. (See Rule 7 flag in Part 1.)

### 5.1 Data pull requirements

- Interval: 1-minute bars.
- Warm-up: 200 EMA and kernel regression need 200+ bars. Pull at least 2 trading days of continuous 1-minute data so the 200 EMA is live from the first tradable minute — confirm whether BBALGO resets at session open or carries continuously, and mirror it.
- Refresh every 60 seconds during the window.
- SPY regime check (daily, Part 2.9): pull SPY daily bars once per session.

### 5.2 Indicator compute order (every new 1-minute bar)

1. EMA9, EMA50, EMA200 (+ Blaise's 5 EMA per 4.3)
2. Kernel estimate (Nadaraya-Watson, rational quadratic, lookback 12, weighting 8, level 25)
3. MACD(4,18,7) + signal
4. RSI(14)
5. ADX(14)
6. ATR(14)
7. RVol (20-bar rolling average)
8. Buy/sell volume split (wick/body proxy, 2.6)
9. Pivots (7L/10R) -> double top/bottom -> BOS/ChoCH
10. Demand/supply zones (sensitivity 20/4 bars, <=15 live per side, mitigation rules)
11. Golden Pocket (ZigZag/ATR auto-fib)
12. TD Sequential 9-count / Perfected 9
13. Kernel state
14. Momentum Scanner composite (placeholder, 2.3)

### 5.3 Session-level gates (once per day, before accepting any signal)

```
if SPY.daily_close <= SPY.daily_200ma:
    disable_longs_today()

if not catalyst_found(ticker):
    skip_ticker(ticker)

trading_window   = (window_start_time, window_end_time)   # hard clock gate
daily_max_loss   = <set before session>
```

### 5.4 Per-bar Tier 3 confluence check

```
def tier3_long(bar):
    return (
        bar.kernel_state == "KRNL Bull"
        and (bar.price_in_demand_zone or bar.price_at_pivot_low or bar.price_in_golden_pocket)
        and (bar.bos_bullish or bar.fresh_choch_to_bullish)
        and bar.rvol >= 2.0
        and bar.momentum_scanner_score >= 3
        and bar.adx_regime != "Consolidating"
    )
# tier3_short is the mirror
```

Optional supplementary check per 4.3 (Blaise's 20 MA retest) — flag separately, don't merge silently:
```
def retest_20ma_long(bar):
    return bar.pulled_back_to_20ema and bar.closed_back_above_20ema and bar.pushing_through_recent_high
```

Chase check: if the signal bar is already extended (high kernel_strength_%, price already spiked off the zone), wait for the retest bar.

### 5.5 Position sizing

```
stop_distance = 2 * atr14
risk_dollars  = account_equity * 0.01
shares        = floor(risk_dollars / stop_distance)
```
No stop, no trade. 2–3 entries max, confirmation-only adds, breakeven stop after adds.

### 5.6 Exit checks (every bar, open positions)

```
def check_exit(position, bar):
    if bar.price crosses stop_distance from entry: close(position)
    if position.zone_mitigated: tighten_or_close(position)
    if bar.choch_against(position.direction): close_or_flip(position)
    if bar.td9_against(position.direction): take_partial(position)
    if bar.absorption_against(position.direction): tighten_stop(position)
```

### 5.7 Guard-check sequence (order matters)

1. Session gate: SPY regime, catalyst, daily loss check
2. Trading window check (hard clock time)
3. Tier 3 confluence check
4. Chase check (wait for retest if extended)
5. Position sizing — no stop, no trade
6. Place order, log to trade journal (setup in one sentence, why entered, planned target/stop)

### 5.8 Watchlist building (replaces the old Minervini Trend Template scan)

The Minervini scan (`32de86d8-ccbf-4000-abe6-078ee8235f00`) is retained as legacy reference only — it doesn't map to BBALGO's confluence rules. Replacement:
1. Build the day's candidate list via catalyst/news scan + earnings calendar + a fixed personal watchlist.
2. Pull 1-minute bars per candidate at/after open, run the Tier 3 check live, bar by bar, only inside the trading window.
3. Still needs to be built and tested as an actual Robinhood-side script — this file is the logic spec, not a wired-up scan.

---

## PART 6 — Post-Win Review (run after every win, not just losses)

1. How could size have been added?
2. What matched other winners?
3. Did sell rules capture an acceptable % of EV?
4. What trackable variables existed?
5. How would you define the setup in one sentence?

---

## PART 7 — Mindset

- Grace when struggling, scrutiny when winning.
- Study winners more than losses.
- Sizing up on proven, repeatable winners plus containing losses fast drives growth — not win rate.
- Journal every trade.
- (Blaise, 4.1.10): trade outcomes are random per-instance — focus on flawless process execution, not any one result.

---

## PART 8 — Known Gaps / Unresolved Items (do not silently resolve — flag back to Coleman)

- **Momentum Scanner composite** (2.3): a placeholder reconstruction, not BBALGO's real proprietary formula. Log every reading against BBALGO's actual chart output before trusting it standalone.
- **EMA/kernel continuity across the overnight gap**: reset vs carry-forward at session open is assumed, not confirmed.
- **Blaise's fixed % sizing (5–10% target / 2–3% stop) vs BBALGO's ATR-based sizing**: two different philosophies, not yet reconciled. Don't merge without Coleman's say-so.
- **Price Action Secrets point #4** (4.4): partially obscured in the source, not fully captured.
- **Robinhood build status**: none of this is wired into a live Robinhood scan/order-placement script yet — this file is the rules and logic spec to build from, not a running system.

---

## Appendix — Glossary Note

The Hot Trades Discord also maintains a general #stock-terms channel (standard trading vocabulary) dating back to 2022. Not reproduced here since it's generic terminology; pull separately if a vocabulary reference is needed.
