#!/usr/bin/env python3
"""Trade journal per momentum spec section 7. Stores to trades.json.

  python3 tools/journal.py open entry.json      # new trade (schema fields)
  python3 tools/journal.py close TICKER EXIT_PRICE EXIT_REASON
  python3 tools/journal.py review TICKER review.json   # post-win answers
  python3 tools/journal.py list
"""
import json
import os
import sys
from datetime import date

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "trades.json")
REASONS = {"target_hit", "stop_hit", "trend_break", "discretionary"}
TEMPLATE = {
    "ticker": "", "date": "", "catalyst": "", "pullback_number": None,
    "entry_price": None, "stop_price": None, "stop_method": "flat_pct",
    "target_price": None, "position_size_pct_risk": None, "num_entries_scaled": 1,
    "indicator_confluence": [], "regime_ok_at_entry": True,
    "exit_price": None, "exit_reason": None, "result_pct": None,
    "post_win_review": {
        "size_up_opportunity": "", "matched_other_winners": "", "ev_captured_pct": None,
        "trackable_variables": [], "one_sentence_setup_definition": "",
    },
    "notes": "",
}
POST_WIN = [
    "1. How could size have been added on this setup?",
    "2. What about this setup matched other past winners?",
    "3. Did the sell rule capture an acceptable % of expected value, or was there meat left on the table?",
    "4. What trackable variables did this trade have? (catalyst type, time of day, volume multiple, confluence used, pullback number)",
    "5. How would this setup be defined in one sentence, for faster recognition next time?",
]


def load():
    return json.load(open(PATH)) if os.path.exists(PATH) else []


def save(rows):
    json.dump(rows, open(PATH, "w"), indent=2)


def find_open(rows, ticker):
    for r in reversed(rows):
        if r["ticker"].upper() == ticker.upper() and r["exit_price"] is None:
            return r
    return None


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__); sys.exit(2)
    rows = load()
    cmd = a[0]
    if cmd == "open":
        e = json.load(open(a[1]))
        row = json.loads(json.dumps(TEMPLATE))
        row.update({k: v for k, v in e.items() if k in TEMPLATE})
        row["date"] = row["date"] or date.today().isoformat()
        for req in ("ticker", "catalyst", "entry_price", "stop_price", "target_price"):
            if not row.get(req):
                print(f"refused: {req} is required before a trade is journaled"); sys.exit(1)
        rows.append(row); save(rows); print(f"opened {row['ticker']} @ {row['entry_price']} stop {row['stop_price']} target {row['target_price']}")
    elif cmd == "close":
        ticker, exit_price, reason = a[1], float(a[2]), a[3]
        if reason not in REASONS:
            print(f"exit_reason must be one of {sorted(REASONS)}"); sys.exit(1)
        r = find_open(rows, ticker)
        if not r:
            print(f"no open trade for {ticker}"); sys.exit(1)
        r["exit_price"] = exit_price
        r["exit_reason"] = reason
        r["result_pct"] = round((exit_price - float(r["entry_price"])) / float(r["entry_price"]) * 100, 2)
        save(rows)
        print(f"closed {r['ticker']} {r['result_pct']:+.2f}% ({reason})")
        if r["result_pct"] > 0:
            print("\nWIN. Post-win review required before this trade is done:")
            print("\n".join(POST_WIN))
            print(f"\nThen: python3 tools/journal.py review {r['ticker']} review.json")
    elif cmd == "review":
        ticker = a[1]
        ans = json.load(open(a[2]))
        target = None
        for r in reversed(rows):
            if r["ticker"].upper() == ticker.upper() and r["exit_price"] is not None:
                target = r; break
        if not target:
            print(f"no closed trade for {ticker}"); sys.exit(1)
        target["post_win_review"].update({k: v for k, v in ans.items() if k in target["post_win_review"]})
        save(rows); print("review saved")
    elif cmd == "list":
        for r in rows:
            state = f"{r['result_pct']:+.2f}% {r['exit_reason']}" if r["exit_price"] is not None else "OPEN"
            print(f"{r['date']} {r['ticker']:6} entry {r['entry_price']} stop {r['stop_price']} target {r['target_price']} | {state}")
        wins = [r for r in rows if r["result_pct"] is not None and r["result_pct"] > 0]
        losses = [r for r in rows if r["result_pct"] is not None and r["result_pct"] <= 0]
        if wins or losses:
            aw = sum(r["result_pct"] for r in wins) / len(wins) if wins else 0
            al = sum(r["result_pct"] for r in losses) / len(losses) if losses else 0
            print(f"closed {len(wins)+len(losses)} | win rate {len(wins)/(len(wins)+len(losses))*100:.0f}% | avg win {aw:+.2f}% | avg loss {al:+.2f}%")
    else:
        print(__doc__); sys.exit(2)


if __name__ == "__main__":
    main()
