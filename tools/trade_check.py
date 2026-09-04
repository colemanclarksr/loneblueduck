#!/usr/bin/env python3
"""Momentum spec trade check + position sizer.

Claude pulls the numbers from Robinhood (quotes, SMA, ATR, RSI, MACD,
earnings/news) and the candle read, writes them to a JSON file, then runs:

    python3 tools/trade_check.py check setup.json

Prints every failed condition by name. Exit code 0 = setup valid, 1 = blocked.
Sizing is printed only when the setup is valid.

Input fields (all required unless noted):
  ticker, account_equity, price, sma20, sma20_5_bars_ago,
  confirmation_candle (bool), pullback_to_sma20 (bool), pullback_number (int),
  volume, avg_volume_20d, catalyst (string, empty = none),
  reversal_candle (one of: bullish_engulfing, three_green_soldiers, morning_star, tweezer_bottom, none),
  confluence (list of: bull_bear_algo, rsi_turning_up, macd_hist_positive),
  spy_close, spy_sma200,
  stop_method ("flat_pct" | "atr"), stop_pct (default 0.025), atr14, atr_mult (default 1.5),
  target_pct (default 0.07), max_position_usd (default 100),
  trades_today (default 0), daily_pnl (default 0), daily_max_loss (default 0 = off)
"""
import json
import sys

REVERSALS = {"bullish_engulfing", "three_green_soldiers", "morning_star", "tweezer_bottom"}
CONFLUENCE = {"bull_bear_algo", "rsi_turning_up", "macd_hist_positive"}


def check(d):
    fails = []
    # Hard overrides first
    if not (d.get("catalyst") or "").strip():
        fails.append("OVERRIDE 5.1: no catalyst")
    if d.get("trades_today", 0) >= 1:
        fails.append("OVERRIDE 5.5: one trading window per day already used")
    dml = float(d.get("daily_max_loss", 0) or 0)
    if dml and float(d.get("daily_pnl", 0)) <= -dml:
        fails.append("OVERRIDE 5.6: daily max loss hit")
    # Regime
    if not float(d["spy_close"]) > float(d["spy_sma200"]):
        fails.append("1: regime off, SPY below 200 SMA")
    # Entry criteria
    price, sma20, sma20_old = float(d["price"]), float(d["sma20"]), float(d["sma20_5_bars_ago"])
    if not (price > sma20 and sma20 > sma20_old):
        fails.append("2.1: not in uptrend (price > 20 SMA and 20 SMA rising over 5 bars)")
    if not d.get("confirmation_candle"):
        fails.append("2.2: no confirmation candle above 20 SMA on volume")
    if not d.get("pullback_to_sma20"):
        fails.append("2.3 / OVERRIDE 5.3: no pullback to 20 SMA, do not chase")
    if int(d.get("pullback_number") or 0) not in (2, 3):
        fails.append("2.4: pullback number must be 2 or 3")
    if not float(d["volume"]) > float(d["avg_volume_20d"]):
        fails.append("2.5: volume not above 20 day average")
    if d.get("reversal_candle") not in REVERSALS:
        fails.append("2.7: no bullish reversal candle at retest")
    if not (set(d.get("confluence") or []) & CONFLUENCE):
        fails.append("2.8: no indicator confluence")
    return fails


def size(d):
    price = float(d["price"])
    method = d.get("stop_method", "flat_pct")
    if method == "atr":
        stop = price - float(d["atr14"]) * float(d.get("atr_mult", 1.5))
    else:
        stop = price * (1 - float(d.get("stop_pct", 0.025)))
    if stop <= 0 or stop >= price:
        return None, "OVERRIDE 5.2: stop level invalid"
    target = price * (1 + float(d.get("target_pct", 0.07)))
    equity = float(d["account_equity"])
    risk_usd = 0.01 * equity
    per_share_risk = price - stop
    size_by_risk = risk_usd / per_share_risk * price
    cap = float(d.get("max_position_usd", 100))
    position = min(size_by_risk, cap)
    actual_risk = position / price * per_share_risk
    return {
        "stop_price": round(stop, 2),
        "stop_method": method,
        "target_price": round(target, 2),
        "risk_budget_usd_1pct": round(risk_usd, 2),
        "size_by_risk_usd": round(size_by_risk, 2),
        "position_usd": round(position, 2),
        "capped_by_rulebook": size_by_risk > cap,
        "actual_risk_usd": round(actual_risk, 2),
        "actual_risk_pct_of_equity": round(actual_risk / equity * 100, 2),
        "shares": round(position / price, 4),
    }, None


def main():
    if len(sys.argv) < 3 or sys.argv[1] != "check":
        print(__doc__)
        sys.exit(2)
    d = json.load(open(sys.argv[2]))
    fails = check(d)
    sizing, err = size(d)
    if err:
        fails.append(err)
    print(f"TICKER {d.get('ticker')}")
    if fails:
        print("BLOCKED. Failed:")
        for f in fails:
            print(f"  - {f}")
        sys.exit(1)
    print("SETUP VALID. Sizing:")
    for k, v in sizing.items():
        print(f"  {k}: {v}")
    sys.exit(0)


if __name__ == "__main__":
    main()
