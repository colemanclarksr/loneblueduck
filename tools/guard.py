#!/usr/bin/env python3
"""Robinhood Execution Guard (trading-guard.md). Final gate before any BUY.

    python3 tools/guard.py order.json

Prints the section 24 decision block. Exit 0 = APPROVED (and writes a single-use
approval to .claude/guard-approval.json that the PreToolUse hook requires),
exit 1 = BLOCKED with the exact reason. Sells never need the guard.

order.json, all from LIVE data pulled immediately before running:
  ticker, action ("BUY"), last, bid, ask, pivot, stop, entry (proposed limit),
  order_type ("limit"|"market"), market_status ("open"|"closed"|"halted"),
  equity, cash, buying_power, equity_high, market ("GREEN"|"YELLOW"|"RED"),
  daily_realized_pnl, consecutive_losses, streak_cleared_by_coleman (bool),
  positions [symbols], open_orders [{symbol, side}],
  score, grade, trend_template (bool), rs ("STRONG"|...), setup, reward_risk,
  earnings_date ("YYYY-MM-DD"|"unknown"), as_of ("YYYY-MM-DD"), fetched_at (ISO time)
"""
import json
import math
import os
import sys
import time
from datetime import date, datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPROVAL = os.path.join(ROOT, ".claude", "guard-approval.json")
REQ = ["ticker", "action", "last", "bid", "ask", "pivot", "stop", "entry", "order_type", "market_status",
       "equity", "cash", "buying_power", "equity_high", "market", "daily_realized_pnl", "consecutive_losses",
       "positions", "open_orders", "score", "grade", "trend_template", "rs", "setup", "reward_risk",
       "earnings_date", "fetched_at"]
APPROVAL_TTL_SEC = 15 * 60


def trading_days_until(d, as_of):
    n, cur = 0, as_of
    while cur < d:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            n += 1
    return n


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    o = json.load(open(sys.argv[1]))
    reasons = []
    missing = [k for k in REQ if k not in o or o[k] in ("", None)]
    if missing:
        reasons.append("BLOCKED — DATA NOT VERIFIED: missing " + ", ".join(missing))
        decide(o, reasons, None); return
    f = lambda k: float(o[k])
    as_of = datetime.strptime(o["as_of"], "%Y-%m-%d").date() if o.get("as_of") else date.today()

    # 2. freshness
    try:
        age = (datetime.utcnow() - datetime.fromisoformat(o["fetched_at"].replace("Z", ""))).total_seconds()
        if age > 300:
            reasons.append(f"BLOCKED — DATA NOT VERIFIED: quote is {age/60:.0f} min old, refresh")
    except Exception:
        reasons.append("BLOCKED — DATA NOT VERIFIED: fetched_at unreadable")
    if o["market_status"] != "open":
        reasons.append(f"BLOCKED — MARKET {o['market_status'].upper()}: no live confirmation possible")
    if o["action"].upper() != "BUY":
        reasons.append("guard only gates BUY; sells and stops go straight through the hook")

    # 3-4. risk and drawdown
    equity, cash, bp, hi = f("equity"), f("cash"), f("buying_power"), f("equity_high")
    dd = (hi - equity) / hi * 100 if hi > 0 else 0.0
    risk_pct = 0.0075
    if dd >= 8:
        reasons.append(f"BLOCKED — DRAWDOWN LIMIT: {dd:.1f}% from equity high")
    elif dd >= 5:
        risk_pct = 0.0025
    elif dd >= 3:
        risk_pct = 0.005
    # 5. market
    mkt = o["market"].upper()
    if mkt == "RED":
        reasons.append("BLOCKED — RED MARKET")
    elif mkt == "YELLOW":
        risk_pct = min(risk_pct, 0.005)
    # 21-22. kill switches
    if f("daily_realized_pnl") <= -0.015 * equity:
        reasons.append(f"BLOCKED — DAILY KILL SWITCH: realized {f('daily_realized_pnl'):.2f} today")
    if int(o["consecutive_losses"]) >= 3:
        if o.get("streak_cleared_by_coleman"):
            risk_pct = min(risk_pct, 0.005)
        else:
            reasons.append("BLOCKED — 3 CONSECUTIVE LOSSES: re-evaluate before resuming")
    max_risk = equity * risk_pct

    # 6. buy signal
    if f("score") < 85: reasons.append(f"BLOCKED — SCORE {f('score'):.0f} < 85")
    if o["grade"] not in ("A", "A+"): reasons.append(f"BLOCKED — GRADE {o['grade']}")
    if not o["trend_template"]: reasons.append("BLOCKED — TREND TEMPLATE FAIL")
    if o["rs"].upper() != "STRONG": reasons.append("BLOCKED — RELATIVE STRENGTH NOT STRONG")
    if f("reward_risk") < 2: reasons.append(f"BLOCKED — REWARD/RISK {f('reward_risk'):.1f} < 2")

    # 7. pivot
    last, pivot, stop, entry = f("last"), f("pivot"), f("stop"), f("entry")
    ext = (last - pivot) / pivot * 100
    if ext > 5: reasons.append(f"BLOCKED — EXTENDED {ext:.1f}% — DO NOT CHASE")
    elif ext > 3: reasons.append(f"BLOCKED — PRICE EXTENDED {ext:.1f}%, WATCH")
    elif ext > 2 and o["grade"] != "A+": reasons.append(f"BLOCKED — {ext:.1f}% above pivot needs A+")
    elif ext < 0: reasons.append(f"BLOCKED — {(-ext):.1f}% BELOW PIVOT, no breakout yet")
    max_limit = pivot * (1.03 if o["grade"] == "A+" else 1.02)
    if entry > max_limit: reasons.append(f"BLOCKED — PRICE EXTENDED: limit {entry:.2f} above zone top {max_limit:.2f}")

    # 8. spread
    bid, ask = f("bid"), f("ask")
    mid = (bid + ask) / 2
    spread = (ask - bid) / mid * 100 if mid > 0 else 99
    if spread > 1 and o["order_type"] == "market": reasons.append(f"BLOCKED — SPREAD TOO WIDE {spread:.2f}% for market order")
    if spread > 2: reasons.append(f"BLOCKED — SPREAD TOO WIDE {spread:.2f}%, liquidity poor")

    # 9. earnings
    earn = o["earnings_date"]
    if earn == "unknown":
        reasons.append("BLOCKED — EARNINGS DATE NOT VERIFIED")
    else:
        days = trading_days_until(datetime.strptime(earn, "%Y-%m-%d").date(), as_of)
        if 0 <= days <= 5: reasons.append(f"BLOCKED — EARNINGS RISK: {days} trading days away")

    # 10. size
    rps = entry - stop
    shares = 0
    if rps <= 0:
        reasons.append("BLOCKED — RISK TOO HIGH: stop not below entry")
    else:
        shares = min(math.floor(max_risk / rps), math.floor(min(cash, bp) / entry))
        if shares < 1: reasons.append(f"BLOCKED — RISK TOO HIGH: 0 whole shares fit ${max_risk:.2f} at ${rps:.2f}/share")
    stop_pct = (entry - stop) / entry * 100 if entry else 0
    if stop_pct > 8: reasons.append(f"BLOCKED — RISK TOO HIGH: stop {stop_pct:.1f}% > 8%")
    pos_val = shares * entry
    if pos_val > min(cash, bp): reasons.append("BLOCKED — INSUFFICIENT BUYING POWER")
    if pos_val > 0.25 * equity: reasons.append(f"BLOCKED — CONCENTRATION: {pos_val/equity*100:.0f}% of equity > 25%")

    # 12, 23. duplicates and averaging down
    t = o["ticker"].upper()
    existing = t in [p.upper() for p in o["positions"]]
    open_buy = any(x.get("symbol", "").upper() == t and x.get("side", "").lower() == "buy" for x in o["open_orders"])
    if open_buy: reasons.append("BLOCKED — DUPLICATE ORDER: open buy already exists")
    if existing and not o.get("add_to_winner_authorized"):
        reasons.append("BLOCKED — EXISTING POSITION: adds need a working trade, a new setup, and Coleman's explicit authorization")

    ctx = dict(last=last, bid=bid, ask=ask, spread=spread, pivot=pivot, ext=ext, entry=entry, stop=stop, stop_pct=stop_pct,
               equity=equity, dd=dd, risk_pct=risk_pct, max_risk=max_risk, rps=rps, shares=shares, pos_val=pos_val,
               existing=existing, open_buy=open_buy, max_limit=max_limit)
    decide(o, reasons, ctx)


def decide(o, reasons, c):
    approved = not reasons
    g = lambda k, fmt="{}": (fmt.format(c[k]) if c else "n/a")
    print(f"""TICKER: {o.get('ticker')}
REQUESTED ACTION: {o.get('action')}
GUARD DECISION: {'APPROVED' if approved else 'BLOCKED'}
CURRENT PRICE: {g('last','${:.2f}')}
BID: {g('bid','${:.2f}')}
ASK: {g('ask','${:.2f}')}
SPREAD: {g('spread','{:.2f}%')}
PIVOT: {g('pivot','${:.2f}')}
EXTENSION FROM PIVOT: {g('ext','{:+.2f}%')}
ENTRY: {g('entry','${:.2f}')} limit (zone top {g('max_limit','${:.2f}')})
STOP: {g('stop','${:.2f}')}
STOP %: {g('stop_pct','{:.1f}%')}
ACCOUNT EQUITY: {g('equity','${:.2f}')}
ACCOUNT DRAWDOWN: {g('dd','{:.1f}%')}
CURRENT RISK LIMIT: {(f"{c['risk_pct']*100:.2f}%" if c else 'n/a')}
MAX DOLLAR RISK: {g('max_risk','${:.2f}')}
RISK/SHARE: {g('rps','${:.2f}')}
SHARES: {g('shares')}
POSITION VALUE: {g('pos_val','${:.2f}')}
MARKET REGIME: {o.get('market')}
MOMENTUM SCORE: {o.get('score')}
GRADE: {o.get('grade')}
EARNINGS DATE: {o.get('earnings_date')}
EXISTING POSITION: {('YES' if c and c['existing'] else 'NO') if c else 'n/a'}
OPEN ORDER: {('YES' if c and c['open_buy'] else 'NO') if c else 'n/a'}
REWARD/RISK: {o.get('reward_risk')}
REASON: {'All checks passed. Approval written, valid 15 minutes, single use.' if approved else ' | '.join(reasons)}""")
    if approved:
        json.dump({"symbol": o["ticker"].upper(), "side": "buy", "shares": c["shares"], "max_limit_price": round(c["max_limit"], 2),
                   "max_notional": round(c["shares"] * c["max_limit"] + 0.01, 2), "order_type_allowed": o["order_type"],
                   "created_at": time.time(), "expires_at": time.time() + APPROVAL_TTL_SEC, "used": False},
                  open(APPROVAL, "w"), indent=2)
    sys.exit(0 if approved else 1)


if __name__ == "__main__":
    main()
