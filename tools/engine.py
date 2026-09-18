#!/usr/bin/env python3
"""Minervini Buy/Hold/Sell engine + scanner output, per trading-engine.md and trading-scanner.md.

  python3 tools/engine.py candidate cand.json [--account account.json]
  python3 tools/engine.py board cand1.json cand2.json ... [--account account.json]
  python3 tools/engine.py r ENTRY STOP PRICE            # R multiple + management mode

account.json (or the same keys inside a candidate):
  equity, cash, equity_high, market (GREEN|YELLOW|RED), allow_fractional (false), as_of (YYYY-MM-DD)

candidate.json required: ticker, price, pivot, stop, sma50, sma150, sma200, sma200_prior, high_52w,
  avg_dollar_volume, earnings_date (YYYY-MM-DD|unknown), rs (STRONG|NEUTRAL|WEAK),
  volume (CONFIRMED|NOT CONFIRMED), eps_growth, rev_growth (string, "unavailable" allowed),
  sector, catalyst, setup, thesis, invalidation, room_to_2r (bool),
  scores {trend,rs,setup,volume,fundamentals,market}, reasons {same keys}
optional: entry (default price)
"""
import json
import math
import sys
from datetime import date, datetime, timedelta

WEIGHTS = {"trend": 20, "rs": 20, "setup": 20, "volume": 15, "fundamentals": 15, "market": 10}
REQ = ["ticker", "price", "pivot", "stop", "sma50", "sma150", "sma200", "sma200_prior", "high_52w",
       "avg_dollar_volume", "earnings_date", "rs", "volume", "eps_growth", "rev_growth", "sector",
       "catalyst", "setup", "thesis", "invalidation", "room_to_2r", "scores", "reasons"]


def trading_days_until(d, as_of):
    n, cur = 0, as_of
    while cur < d:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            n += 1
    return n


def risk_pct(acct):
    """Base 0.75%, YELLOW 0.50%, RED none. Drawdown tiers cap it further. Returns (pct, halt_reason)."""
    market = acct.get("market", "GREEN").upper()
    if market == "RED":
        return 0.0, "MARKET RED: NO NEW LONG POSITIONS"
    pct = 0.0075 if market == "GREEN" else 0.005
    eq, hi = float(acct["equity"]), float(acct.get("equity_high", acct["equity"]))
    dd = (hi - eq) / hi if hi > 0 else 0
    if dd >= 0.08:
        return 0.0, f"DRAWDOWN {dd*100:.1f}% from equity high: STOP NEW LIVE TRADES"
    if dd >= 0.05:
        pct = min(pct, 0.0025)
    elif dd >= 0.03:
        pct = min(pct, 0.005)
    return pct, None


def grade_of(score):
    if score >= 90: return "A+"
    if score >= 85: return "A"
    if score >= 75: return "B"
    if score >= 65: return "C"
    return "REJECT"


def evaluate(c, acct):
    missing = [k for k in REQ if k not in c or c[k] in ("", None)]
    if missing:
        return {"ticker": c.get("ticker", "?"), "status": "DATA INSUFFICIENT — NO TRADE", "notes": ["missing: " + ", ".join(missing)]}
    for k in WEIGHTS:
        if k not in c["scores"] or k not in c["reasons"]:
            return {"ticker": c["ticker"], "status": "DATA INSUFFICIENT — NO TRADE", "notes": [f"score/reason missing: {k}"]}
    f = lambda k: float(c[k])
    as_of = datetime.strptime(acct["as_of"], "%Y-%m-%d").date() if acct.get("as_of") else date.today()
    price, pivot, stop = f("price"), f("pivot"), f("stop")
    entry = float(c.get("entry", price))
    notes = []

    tt = {"P>50": price > f("sma50"), "P>150": price > f("sma150"), "P>200": price > f("sma200"),
          "50>150": f("sma50") > f("sma150"), "150>200": f("sma150") > f("sma200"), "200 rising": f("sma200") > f("sma200_prior")}
    template = all(tt.values())
    off_high = (f("high_52w") - price) / f("high_52w") * 100
    if off_high > 25: notes.append(f"{off_high:.0f}% off 52w high")
    if f("avg_dollar_volume") < 25e6: notes.append(f"info: dollar volume ${f('avg_dollar_volume')/1e6:.1f}M, thin, limit orders only")

    score = 0.0
    for k, w in WEIGHTS.items():
        s = float(c["scores"][k])
        if not 0 <= s <= w:
            return {"ticker": c["ticker"], "status": "DATA INSUFFICIENT — NO TRADE", "notes": [f"score {k}={s} outside 0-{w}"]}
        score += s
    if not template:
        score = min(score, 64); notes.append("trend template FAIL: " + ", ".join(k for k, v in tt.items() if not v))
    grade = grade_of(score)

    dist = (entry - pivot) / pivot * 100
    if dist < 0: pivot_state = "BELOW PIVOT"
    elif dist <= 2: pivot_state = "BREAKING OUT"
    elif dist <= 5: pivot_state = "EXTENDED (watch)"
    else: pivot_state = "EXTENDED (do not buy)"

    if stop >= entry:
        return {"ticker": c["ticker"], "status": "DATA INSUFFICIENT — NO TRADE", "notes": ["stop must be below entry"]}
    stop_pct = (entry - stop) / entry * 100
    rps = entry - stop

    pct, halt = risk_pct(acct)
    equity, cash = float(acct["equity"]), float(acct["cash"])
    risk_usd = equity * pct
    if rps > 0 and pct > 0:
        rs_sh = risk_usd / rps
        cap_sh = cash / entry
        shares = min(rs_sh, cap_sh)
        shares = round(shares, 4) if acct.get("allow_fractional") else math.floor(shares)
    else:
        shares = 0
    pos_val = shares * entry
    max_loss = shares * rps
    r1, r2, r3 = entry + rps, entry + 2 * rps, entry + 3 * rps

    earn = c["earnings_date"]
    earn_days = None
    if earn != "unknown":
        earn_days = trading_days_until(datetime.strptime(earn, "%Y-%m-%d").date(), as_of)

    # Status
    if not template or grade == "REJECT":
        status = "PASS"
    elif halt:
        status = "WATCH"; notes.append(halt)
    elif stop_pct > 8:
        status = "PASS"; notes.append(f"stop {stop_pct:.1f}% exceeds 8% max, excessive risk")
    elif not c["room_to_2r"]:
        status = "PASS"; notes.append("insufficient room to 2R")
    elif earn == "unknown":
        status = "WATCH"; notes.append("earnings date unknown")
    elif earn_days is not None and 0 <= earn_days <= 5:
        status = "WATCH — EARNINGS RISK"; notes.append(f"earnings in {earn_days} trading days")
    elif grade not in ("A+", "A", "B"):
        # Grade floor lowered to B (score 75) by Coleman, 2026-09-09. YELLOW no longer
        # requires A+; YELLOW still cuts risk to 0.50% and RED still blocks all buys.
        status = "WATCH"; notes.append(f"grade {grade}, floor is B")
    elif dist < 0:
        status = "WATCH"; notes.append(f"{-dist:.1f}% below pivot, wait for breakout")
    elif dist > 5:
        status = "WATCH"; notes.append(f"{dist:.1f}% above pivot, do not buy")
    elif dist > 3:
        status = "WATCH"; notes.append(f"{dist:.1f}% above pivot")
    elif dist > 2 and grade != "A+":
        status = "WATCH"; notes.append(f"{dist:.1f}% above pivot, needs A+")
    elif c["volume"].upper() != "CONFIRMED":
        status = "WATCH"; notes.append("volume not confirmed")
    elif shares < 1 and not acct.get("allow_fractional"):
        status = "WATCH"; notes.append(f"0 whole shares fit ${risk_usd:.2f} risk at ${rps:.2f}/share (stock too expensive for this budget)")
    elif shares <= 0:
        status = "WATCH"; notes.append("no size")
    else:
        status = "BUY NOW"
    if stop_pct < 3: notes.append(f"stop {stop_pct:.1f}% is tighter than the 3% floor, confirm it sits under structure")
    if pos_val > 0.25 * equity: notes.append(f"position {pos_val/equity*100:.0f}% of account, above the 25% norm")

    return dict(ticker=c["ticker"], status=status, grade=grade, score=score, price=price, setup=c["setup"],
                pivot=pivot, dist=dist, pivot_state=pivot_state, entry=entry, stop=stop, stop_pct=stop_pct,
                rps=rps, risk_pct=pct, risk_usd=risk_usd, max_loss=max_loss, shares=shares, pos_val=pos_val,
                pos_pct=pos_val / equity * 100, r1=r1, r2=r2, r3=r3, rs=c["rs"], volume=c["volume"],
                eps=c["eps_growth"], rev=c["rev_growth"], sector=c["sector"], earn=earn, catalyst=c["catalyst"],
                thesis=c["thesis"], invalidation=c["invalidation"], scores=c["scores"], reasons=c["reasons"],
                notes=notes, equity=equity, market=acct.get("market", "GREEN").upper())


def render(r, rank=None):
    head = f"#{rank} {r['ticker']}" if rank else r["ticker"]
    if r["status"].startswith("DATA INSUFFICIENT"):
        return f"{head}\nSTATUS: {r['status']}\n  " + "\n  ".join(r["notes"])
    sh = f"{r['shares']:.4f}" if isinstance(r["shares"], float) and r["shares"] != int(r["shares"]) else f"{int(r['shares'])}"
    out = f"""{head}
STATUS: {r['status']}
GRADE: {r['grade']}
MOMENTUM SCORE: {r['score']:.0f}/100
CURRENT PRICE: ${r['price']:.2f}
SETUP: {r['setup']}
PIVOT: ${r['pivot']:.2f}
DISTANCE FROM PIVOT: {r['dist']:+.1f}% ({r['pivot_state']})
ENTRY ZONE: ${r['entry']:.2f}
STOP: ${r['stop']:.2f}
STOP %: {r['stop_pct']:.1f}%
RISK/SHARE: ${r['rps']:.2f}
ACCOUNT EQUITY: ${r['equity']:.2f}   RISK: {r['risk_pct']*100:.2f}% = ${r['risk_usd']:.2f}
MAX ACCOUNT LOSS: ${r['max_loss']:.2f}
SHARES: {sh}
POSITION VALUE: ${r['pos_val']:.2f}
ACCOUNT %: {r['pos_pct']:.1f}%
1R: ${r['r1']:.2f}   2R: ${r['r2']:.2f}   3R: ${r['r3']:.2f}
MARKET: {r['market']}
RELATIVE STRENGTH: {r['rs']}
VOLUME: {r['volume']}
EPS GROWTH: {r['eps']}
REVENUE GROWTH: {r['rev']}
SECTOR: {r['sector']}
EARNINGS DATE: {r['earn']}
CATALYST: {r['catalyst']}
WHY IT RANKS: """ + "; ".join(f"{k} {float(r['scores'][k]):.0f}/{WEIGHTS[k]} {r['reasons'][k]}" for k in WEIGHTS) + f"""
INVALIDATION: {r['invalidation']}
THESIS: {r['thesis']}"""
    if r["notes"]:
        out += "\nNOTES:\n  - " + "\n  - ".join(r["notes"])
    return out


def load_account(args):
    acct = {}
    if "--account" in args:
        i = args.index("--account"); acct = json.load(open(args[i + 1])); del args[i:i + 2]
    return acct


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__); sys.exit(2)
    cmd = a.pop(0)
    if cmd == "r":
        entry, stop, price = map(float, a[:3])
        rps = entry - stop
        R = (price - entry) / rps
        if price <= stop: mode = "SELL: hard stop reached"
        elif R < 1: mode = "HOLD if technically healthy (0-1R). No tiny profits."
        elif R < 2: mode = "HOLD strong stock (1-2R). Monitor price/volume."
        elif R < 3: mode = "PROFIT PROTECTION MODE (2R+). Consider raising stop if structure allows."
        elif R < 4: mode = "INCREASED PROTECTION (3R+). Do not let this become a loss."
        else: mode = "TRAIL technically (4R+). No arbitrary target. Trim 25-50% only on abnormal extension."
        print(f"entry {entry:.2f} stop {stop:.2f} price {price:.2f} | 1R=${rps:.2f} | now {R:+.2f}R\n1R {entry+rps:.2f}  2R {entry+2*rps:.2f}  3R {entry+3*rps:.2f}  4R {entry+4*rps:.2f}\n{mode}")
        return
    acct = load_account(a)
    if cmd == "candidate":
        c = json.load(open(a[0])); acct = {**c.get("account", {}), **acct}
        r = evaluate(c, acct); print(render(r)); sys.exit(0 if r["status"] == "BUY NOW" else 1)
    if cmd == "board":
        results = []
        for p in a:
            c = json.load(open(p)); ac = {**c.get("account", {}), **acct}
            results.append(evaluate(c, ac))
        order = {"BUY NOW": 0, "WATCH — EARNINGS RISK": 1, "WATCH": 1, "PASS": 2}
        results.sort(key=lambda r: (order.get(r["status"], 3), -r.get("score", 0), -float(r.get("scores", {}).get("setup", 0))))
        results = results[:5]
        for i, r in enumerate(results, 1):
            print("=" * 28); print(render(r, i))
        print("=" * 28)
        print("RANK | TICKER | SCORE | STATUS | PIVOT | ENTRY | STOP | SHARES")
        for i, r in enumerate(results, 1):
            if r["status"].startswith("DATA"):
                print(f"{i} | {r['ticker']} | - | {r['status']} | - | - | - | -"); continue
            print(f"{i} | {r['ticker']} | {r['score']:.0f} | {r['status']} | {r['pivot']:.2f} | {r['entry']:.2f} | {r['stop']:.2f} | {r['shares']}")
        buys = [r for r in results if r["status"] == "BUY NOW"]
        best = buys[0] if buys else (results[0] if results and not results[0]["status"].startswith(("PASS", "DATA")) else None)
        print(f"\nBEST SETUP: {best['ticker'] if best else 'NONE'}")
        print(f"BEST ACTION RIGHT NOW: {'BUY' if buys else ('WATCH' if best else 'CASH')}")
        return
    print(__doc__); sys.exit(2)


if __name__ == "__main__":
    main()
