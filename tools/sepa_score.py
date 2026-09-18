#!/usr/bin/env python3
"""Momentum score, grade, sizing, and section 17 output block per trading-role.md.

    python3 tools/sepa_score.py candidate.json

Claude fills candidate.json from live Robinhood data. Sub-scores are Claude's
judgment, each with a one line reason; this tool enforces the weights, the
trend template, the 80 minimum, the stop range, the extension check, the
earnings flag, the risk formula, and the sandbox cap. Missing required data
prints DATA INSUFFICIENT — NO TRADE and exits 1.

Required: ticker, price, pivot, stop, sma50, sma150, sma200, sma200_prior,
  high_52w, avg_dollar_volume, earnings_date (YYYY-MM-DD or "unknown"),
  regime (BULLISH|NEUTRAL|BEARISH), rs (Strong|Neutral|Weak), setup, thesis,
  invalidation, confidence, volume_confirmation, sector_strength,
  scores: {trend, rs, setup, volume, fundamentals, market} with reasons: {same keys}
Optional: account_equity (500), risk_pct (0.005), max_position_usd (100),
  min_score (80), entry (defaults to price), as_of (YYYY-MM-DD, default today)
"""
import json
import sys
from datetime import date, datetime

WEIGHTS = {"trend": 20, "rs": 20, "setup": 20, "volume": 15, "fundamentals": 15, "market": 10}
REQUIRED = ["ticker", "price", "pivot", "stop", "sma50", "sma150", "sma200", "sma200_prior",
            "high_52w", "avg_dollar_volume", "earnings_date", "regime", "rs", "setup", "thesis",
            "invalidation", "confidence", "volume_confirmation", "sector_strength", "scores", "reasons"]


def insufficient(why):
    print(f"DATA INSUFFICIENT — NO TRADE ({why})")
    sys.exit(1)


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    d = json.load(open(sys.argv[1]))
    missing = [k for k in REQUIRED if k not in d or d[k] in ("", None)]
    if missing:
        insufficient("missing: " + ", ".join(missing))
    for k in WEIGHTS:
        if k not in d["scores"] or k not in d["reasons"]:
            insufficient(f"score or reason missing for {k}")

    f = lambda k: float(d[k])
    price, pivot, stop = f("price"), f("pivot"), f("stop")
    entry = float(d.get("entry", price))
    equity = float(d.get("account_equity", 500))
    risk_pct = float(d.get("risk_pct", 0.005))
    cap = float(d.get("max_position_usd", 100))
    min_score = float(d.get("min_score", 80))
    as_of = datetime.strptime(d["as_of"], "%Y-%m-%d").date() if d.get("as_of") else date.today()

    flags = []
    # Trend template
    tt = {
        "price > 50 SMA": price > f("sma50"),
        "price > 150 SMA": price > f("sma150"),
        "price > 200 SMA": price > f("sma200"),
        "50 SMA > 150 SMA": f("sma50") > f("sma150"),
        "150 SMA > 200 SMA": f("sma150") > f("sma200"),
        "200 SMA rising": f("sma200") > f("sma200_prior"),
    }
    template_pass = all(tt.values())
    pct_off_high = (f("high_52w") - price) / f("high_52w") * 100
    if pct_off_high > 25:
        flags.append(f"{pct_off_high:.1f}% below 52w high (prefer within 25%)")
    # Universe
    if price <= 10:
        flags.append("price under $10")
    if f("avg_dollar_volume") < 25_000_000:
        flags.append("avg dollar volume under $25M")
    # Stop
    if stop >= entry:
        insufficient("stop must be below entry")
    stop_pct = (entry - stop) / entry * 100
    if not 3 <= stop_pct <= 7:
        flags.append(f"stop is {stop_pct:.1f}% below entry (typical 3-7%)")
    # Extension
    ext = (entry - pivot) / pivot * 100
    extended = ext > 5
    if extended:
        flags.append(f"entry {ext:.1f}% above pivot, reassess (>5% extended)")
    # Earnings
    event_risk = False
    if d["earnings_date"] == "unknown":
        flags.append("earnings date unknown")
        event_risk = True
    else:
        ed = datetime.strptime(d["earnings_date"], "%Y-%m-%d").date()
        days = (ed - as_of).days
        if 0 <= days <= 10:
            flags.append(f"EVENT RISK: earnings in {days} days")
            event_risk = True
    # Score
    score = 0
    for k, w in WEIGHTS.items():
        s = float(d["scores"][k])
        if s < 0 or s > w:
            insufficient(f"score {k}={s} outside 0-{w}")
        score += s
    if not template_pass:
        score = min(score, 59)
    # Sizing
    risk_usd = equity * risk_pct
    rps = entry - stop
    shares_by_risk = risk_usd / rps
    usd_by_risk = shares_by_risk * entry
    position_usd = min(usd_by_risk, cap)
    shares = position_usd / entry
    actual_risk = shares * rps
    # Grade and status
    if score >= 90 and template_pass and not extended and not event_risk and d["rs"] == "Strong":
        grade = "A+"
    elif score >= 80:
        grade = "A"
    elif score >= 70:
        grade = "B"
    elif score >= 60:
        grade = "C"
    else:
        grade = "REJECT"
    if not template_pass or score < 60:
        status = "REJECT"
    elif score >= min_score and not extended and d["regime"] != "BEARISH" and not event_risk and 3 <= stop_pct <= 7:
        status = "BUY"
    else:
        status = "WATCH"

    print(f"""TICKER: {d['ticker']}
MOMENTUM SCORE: {score:.0f}/100
GRADE: {grade}
MARKET REGIME: {d['regime']}
TREND: {'Pass' if template_pass else 'Fail'}  ({', '.join(k for k, v in tt.items() if not v) or 'all six conditions met'})
RELATIVE STRENGTH: {d['rs']}
SETUP: {d['setup']}
PIVOT: ${pivot:.2f}
ENTRY ZONE: ${entry:.2f}  ({ext:+.1f}% vs pivot)
STOP: ${stop:.2f}  (-{stop_pct:.1f}%)
RISK PER SHARE: ${rps:.2f}
POSITION SIZE: ${position_usd:.2f} ({shares:.4f} shares){'  [capped at $' + f'{cap:.0f}' + ', risk-sized would be $' + f'{usd_by_risk:.2f}' + ']' if usd_by_risk > cap else ''}
ACCOUNT RISK: ${actual_risk:.2f} ({actual_risk / equity * 100:.2f}% of ${equity:.0f})
EARNINGS DATE: {d['earnings_date']}
VOLUME CONFIRMATION: {d['volume_confirmation']}
SECTOR STRENGTH: {d['sector_strength']}
TRADE STATUS: {status}
CONFIDENCE: {d['confidence']}
THESIS: {d['thesis']}
INVALIDATION: {d['invalidation']}

Score breakdown:""")
    for k, w in WEIGHTS.items():
        print(f"  {k:12} {float(d['scores'][k]):>4.0f}/{w:<3} {d['reasons'][k]}")
    if flags:
        print("Flags:")
        for x in flags:
            print(f"  - {x}")
    sys.exit(0 if status == "BUY" else 1)


if __name__ == "__main__":
    main()
