# Daily Momentum Trading Strategy — Spec

**Scope:** Capped speculation lane. Reference only. Never enters an income plan or gets treated as reliable cash flow. This document is the full rule set for building a scanner, journal, or trade-check tool in Claude Code.

**Status:** Reference spec, superseded for live trades by `.claude/trading-guard.md`, `.claude/trading-engine.md`, and `.claude/trading-scanner.md`. Implemented as `tools/trade_check.py` and `tools/journal.py`. Its catalyst requirement, 2-3% stop, and 5-10% target do not apply under the engine.

---

## 1. Market Regime Filter (check first, every day)

Before scanning for any setup, confirm the broader market allows longs.

- **Rule:** SPY price > SPY 200-day simple moving average
- **If false:** no new long entries today, regardless of how good an individual setup looks. Log the day as "regime off" and stop scanning.
- **If true:** proceed to scanning.

```
regime_ok = SPY.close > SPY.sma(200)
```

---

## 2. Entry Criteria (all required, no exceptions)

A ticker only qualifies for entry if every condition below is true.

| # | Condition | Logic |
|---|-----------|-------|
| 1 | Uptrend confirmed | price > 20-period SMA, and 20 SMA is sloping up over last 5 bars |
| 2 | Momentum confirmation candle occurred | a green candle broke above the 20 SMA on above-average volume, marks the start of the move |
| 3 | Pullback/retest, not the initial spike | price has pulled back to retest the 20 SMA after the confirmation candle |
| 4 | Pullback count preference | this is the 2nd or 3rd pullback in the current trend leg, not the 1st (1st pullback has a lower success rate, higher-low structure not yet proven) |
| 5 | Volume | volume on the move is above the 20-day average volume |
| 6 | Catalyst present | news, earnings beat, analyst upgrade, or product launch within the last 1-3 sessions. No catalyst = disqualified, full stop |
| 7 | Price action confirms | bullish engulfing, three green soldiers, morning star, or tweezer bottom forming at the retest level |
| 8 | Indicator confluence | at least ONE of: Bull Bear Algo bullish signal, RSI turning up from below 50 (not necessarily oversold), MACD histogram turning positive |

```
setup_valid = (
    price > sma20 and sma20.slope(5) > 0
    and confirmation_candle_present
    and is_pullback_to_sma20
    and pullback_number in [2, 3]
    and volume > avg_volume_20d
    and catalyst_present
    and bullish_reversal_candle_present
    and (bull_bear_algo_bullish or rsi_turning_up or macd_hist_turning_positive)
    and regime_ok
)
```

**No catalyst = no trade. No stop level defined = no trade. These two override everything else, even a perfect chart.**

---

## 3. Position Sizing & Risk

- Max account risk per trade: **1%**, defined and locked in before the first entry
- Scale in a maximum of **2-3 entries** per position
- Sizing method: fixed lots or pyramid UP on confirmation only
- **Never pyramid down** without a pre-planned price level set in advance
- Each add-in has its own independent stop
- Once all adds are placed, move the stop on the earliest entry to breakeven

```
max_risk_per_trade = 0.01 * account_equity
entries_allowed = 2 to 3
pyramid_direction = "up only, on confirmed strength"
stop_after_full_size = "breakeven on first entry"
```

---

## 4. Exit Rules

- **Profit target:** 5-10% gain
- **Stop loss, choose one method and test both:**
  - Flat percentage: 2-3% below entry
  - ATR-based: 1.5-2x ATR below entry (adapts to the individual stock's volatility, test against flat % before fully switching)
- Both target and stop are set **before** entry. No adjusting after the fact.
- **Trend exit:** close below the moving average the position rode up on, exit regardless of P/L
- **Never move a stop further away mid-trade.** Only moves allowed: tightening, or to breakeven once adds are placed.

```
target_pct = 0.05 to 0.10
stop_method = "flat_pct" or "atr"
stop_pct = 0.02 to 0.03  # if flat_pct
stop_atr_mult = 1.5 to 2.0  # if atr
exit_on_trend_break = price.close < sma20  # even if in profit
```

---

## 5. Hard Overrides (kill switches, apply before anything else)

These are not preferences. If any is true, there is no trade.

1. No catalyst identified → no trade
2. No stop-loss level defined and locked before entry → no trade
3. Stock has already spiked and no retest has occurred yet → wait, do not chase
4. Averaging down without a pre-planned price level → not allowed, ever
5. One trading window per day, then stop screens
6. Daily max loss hit → done trading for the day, no revenge trades, no exceptions

```
if not catalyst_present: block_trade()
if stop_price is None: block_trade()
if daily_pnl <= -daily_max_loss: halt_trading_for_day()
if trades_today >= 1_trading_window_limit: halt_trading_for_day()
```

---

## 6. Post-Win Review (run after every winning trade, not just losses)

Most traders over-study losses and under-study winners. Flip that. After a win closes, log answers to:

1. How could size have been added on this setup?
2. What about this setup matched other past winners?
3. Did the sell rule capture an acceptable % of the expected value, or was there meat left on the table?
4. What trackable variables did this trade have? (catalyst type, time of day, volume multiple, indicator confluence used, pullback number)
5. How would this setup be defined in one sentence, for faster recognition next time?

**Mindset rule:** grace when struggling, scrutiny when winning. Sizing up on proven, repeatable winners while containing losses fast is the actual growth engine, not win rate.

---

## 7. Trade Journal Schema

Every trade, win or loss, logs the following fields:

```
{
  "ticker": "",
  "date": "",
  "catalyst": "",
  "pullback_number": null,
  "entry_price": null,
  "stop_price": null,
  "stop_method": "flat_pct | atr",
  "target_price": null,
  "position_size_pct_risk": null,
  "num_entries_scaled": null,
  "indicator_confluence": [],
  "regime_ok_at_entry": true,
  "exit_price": null,
  "exit_reason": "target_hit | stop_hit | trend_break | discretionary",
  "result_pct": null,
  "post_win_review": {
    "size_up_opportunity": "",
    "matched_other_winners": "",
    "ev_captured_pct": null,
    "trackable_variables": [],
    "one_sentence_setup_definition": ""
  },
  "notes": ""
}
```

---

## 8. Implementation Notes for Claude Code

- Data needed: OHLCV daily bars (min 200 days history for regime filter and 20/200 SMA calcs), intraday volume for confluence check
- Indicators to compute: SMA(20), SMA(200) on SPY, ATR(14), RSI(14), MACD(12,26,9), Bull Bear Algo signal (if source available, otherwise flag as manual input)
- Candle pattern detection needed: bullish engulfing, three green soldiers, morning star, tweezer bottom
- Suggested build order: (1) regime filter check, (2) universe scanner applying entry criteria, (3) position sizing calculator, (4) trade journal logger, (5) post-win review prompt trigger on any closed trade with positive result_pct
- This is a **screening and journaling tool, not an auto-execution system.** Every trade still requires manual confirmation before it goes to Robinhood.
