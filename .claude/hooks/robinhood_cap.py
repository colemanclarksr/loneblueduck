#!/usr/bin/env python3
"""Hard dollar cap on Robinhood MCP trading tools.

Runs as a Claude Code PreToolUse hook (blocks orders that would push open
exposure past the cap) and PostToolUse hook (records placed orders in a
ledger). Fails closed: anything the hook cannot price is denied.

Exposure = cost basis of open positions plus resting buy orders. A sell only
reduces exposure once it FILLS; a resting stop or limit sell leaves the
ledger alone. If a resting order fills later (the hook never sees that), fix
the ledger with `fill` or `set-exposure`.

CLI:
  robinhood_cap.py status                        cap, exposure, remaining, positions
  robinhood_cap.py fill SYMBOL SIDE SHARES PRICE  record a fill the hook missed
  robinhood_cap.py set-exposure <usd>            override the exposure total
  robinhood_cap.py reset                         zero the ledger
"""
import json
import os
import re
import sys
from decimal import Decimal, InvalidOperation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "robinhood-cap.json")
LEDGER = os.path.join(ROOT, "robinhood-cap-ledger.json")
APPROVAL = os.path.join(ROOT, "guard-approval.json")

ORDER_TOOLS = ("place_equity_order", "place_option_order", "place_crypto_order")
EXERCISE_TOOL = "exercise_option"
ZERO = Decimal("0")


def money(v):
    try:
        d = Decimal(str(v))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return d if d > 0 else None


def load_config():
    with open(CONFIG) as f:
        return json.load(f)


def load_cap():
    return Decimal(str(load_config()["cap_usd"]))


def load_ledger():
    if not os.path.exists(LEDGER):
        return {"exposure_usd": "0", "positions": {}, "orders": []}
    with open(LEDGER) as f:
        ledger = json.load(f)
    ledger.setdefault("positions", {})
    ledger.setdefault("orders", [])
    return ledger


def save_ledger(ledger):
    with open(LEDGER, "w") as f:
        json.dump(ledger, f, indent=2)


def short_name(tool_name):
    return tool_name.rsplit("__", 1)[-1]


def notional(tool, p):
    """Return (side, usd_notional or None, reason_if_unpriceable)."""
    side = (p.get("side") or "").lower()
    if tool == "place_equity_order" or tool == "place_crypto_order":
        if side not in ("buy", "sell"):
            return side, None, "side must be buy or sell"
        da = money(p.get("dollar_amount"))
        if da is not None:
            return side, da, None
        qty = money(p.get("quantity"))
        price = money(p.get("limit_price")) or money(p.get("stop_price"))
        if qty is not None and price is not None:
            return side, qty * price, None
        return side, None, "cannot price this order; use dollar_amount or a limit/stop price"

    if tool == "place_option_order":
        legs = p.get("legs") or []
        if not legs:
            return "buy", None, "no legs"
        closing_only = all((l.get("position_effect") or "").lower() == "close" for l in legs)
        if closing_only:
            return "sell", ZERO, None
        short_open = any(
            (l.get("side") or "").lower() == "sell" and (l.get("position_effect") or "").lower() == "open"
            for l in legs
        )
        if short_open or (p.get("direction") or "").lower() == "credit":
            return "buy", None, "short/credit option positions have risk beyond the premium and are not allowed under the cap"
        qty = money(p.get("quantity"))
        price = money(p.get("price"))
        if qty is None or price is None:
            return "buy", None, "option orders must be limit orders with a price under the cap"
        return "buy", qty * price * Decimal("100"), None

    return "buy", None, "unknown tool"


def guard_check(tool, p, amt):
    """Execution guard: a buy needs a live, unused approval for this symbol, size, and price."""
    import time
    if tool == "place_crypto_order":
        return False, "BLOCKED — crypto is outside the governing strategy (trading-engine.md)"
    if not os.path.exists(APPROVAL):
        return False, "BLOCKED — GUARD NOT RUN: run python3 tools/guard.py order.json with live data first"
    a = json.load(open(APPROVAL))
    if a.get("used"):
        return False, "BLOCKED — DUPLICATE ORDER: approval already used, run the guard again"
    if time.time() > float(a.get("expires_at", 0)):
        return False, "BLOCKED — DATA NOT VERIFIED: guard approval expired, refresh and rerun the guard"
    if (p.get("symbol") or "").upper() != a.get("symbol"):
        return False, f"BLOCKED — GUARD MISMATCH: approval is for {a.get('symbol')}, order is {p.get('symbol')}"
    otype = (p.get("type") or "").lower()
    if a.get("order_type_allowed") == "limit" and otype != "limit":
        return False, "BLOCKED — LIMIT ORDER REQUIRED by guard"
    lp = money(p.get("limit_price"))
    if otype == "limit" and lp is not None and lp > Decimal(str(a["max_limit_price"])):
        return False, f"BLOCKED — PRICE EXTENDED: limit {lp} above guard zone top {a['max_limit_price']}"
    qty = money(p.get("quantity"))
    if qty is not None and qty > Decimal(str(a["shares"])):
        return False, f"BLOCKED — SIZE: {qty} shares exceeds guard approval of {a['shares']}"
    if amt > Decimal(str(a["max_notional"])):
        return False, f"BLOCKED — SIZE: ${amt:.2f} exceeds guard approval of ${a['max_notional']}"
    return True, None


def decide(tool_name, p):
    tool = short_name(tool_name)
    cfg = load_config()
    cap = Decimal(str(cfg["cap_usd"]))
    per_order = money(cfg.get("per_order_max_usd"))
    ledger = load_ledger()
    exposure = Decimal(str(ledger.get("exposure_usd", "0")))
    remaining = cap - exposure

    if not cfg.get("options_allowed", False) and tool in ("place_option_order", EXERCISE_TOOL):
        return False, "BLOCKED by rulebook: options are banned (trading-strategy.md rule 2)."

    if tool == EXERCISE_TOOL:
        return False, f"BLOCKED by ${cap} trading cap: exercising options requires cash beyond the cap. Sell to close instead."

    side, amt, why = notional(tool, p)
    if side == "sell":
        return True, None
    if amt is None:
        return False, f"BLOCKED by ${cap} trading cap: {why}."
    ok, gwhy = guard_check(tool, p, amt)
    if not ok:
        return False, gwhy
    if per_order is not None and amt > per_order:
        return False, f"BLOCKED by rulebook: this order is ${amt:.2f}, max per position is ${per_order:.2f} (rule 3)."
    if amt > remaining:
        return False, (
            f"BLOCKED by ${cap} deployed cap (rule 3): this order is ${amt:.2f}, deployed is "
            f"${exposure:.2f}, room is ${remaining:.2f}. Reduce the order or close something first."
        )
    return True, None


# ---------------------------------------------------------------- ledger math

def _field(text, name):
    """Pull the first "name": value out of a JSON-ish response, or None."""
    m = re.search(r'"%s"\s*:\s*"?([^",}\]]+)"?' % re.escape(name), text)
    return m.group(1).strip() if m else None


def parse_fill(text):
    """Return (state, filled_shares, avg_price, order_id) from a broker response."""
    state = (_field(text, "state") or "").lower()
    filled = money(_field(text, "cumulative_quantity"))
    avg = money(_field(text, "average_price"))
    oid = _field(text, "id")
    if state == "filled" and filled is None:
        filled = money(_field(text, "quantity"))
    return state, filled, avg, oid


def apply_buy(ledger, symbol, shares, price):
    """Add cost basis for a buy (a fill, or a resting order reserved at its limit)."""
    pos = ledger["positions"].get(symbol, {"shares": "0", "cost_usd": "0"})
    new_sh = Decimal(pos["shares"]) + shares
    new_cost = Decimal(pos["cost_usd"]) + shares * price
    ledger["positions"][symbol] = {"shares": f"{new_sh:.6f}", "cost_usd": f"{new_cost:.2f}"}


def apply_sell(ledger, symbol, shares):
    """Release cost basis pro rata for shares that actually sold. Returns usd released."""
    pos = ledger["positions"].get(symbol)
    if not pos or Decimal(pos["shares"]) <= 0:
        return ZERO
    have = Decimal(pos["shares"])
    cost = Decimal(pos["cost_usd"])
    sold = min(shares, have)
    released = cost * sold / have
    left_sh = have - sold
    left_cost = cost - released
    if left_sh <= 0:
        del ledger["positions"][symbol]
    else:
        ledger["positions"][symbol] = {"shares": f"{left_sh:.6f}", "cost_usd": f"{left_cost:.2f}"}
    return released


def recompute(ledger):
    total = sum(Decimal(v["cost_usd"]) for v in ledger["positions"].values())
    total += sum(Decimal(o["usd"]) for o in ledger["orders"] if o.get("pending_buy"))
    ledger["exposure_usd"] = f"{max(ZERO, total):.2f}"
    return ledger


def record(tool_name, p, response):
    tool = short_name(tool_name)
    if tool not in ORDER_TOOLS:
        return
    text = json.dumps(response) if not isinstance(response, str) else response
    if isinstance(response, dict) and response.get("isError"):
        return
    if '"error"' in text.lower()[:400]:
        return
    side, amt, _ = notional(tool, p)
    if amt is None:
        amt = ZERO
    symbol = (p.get("symbol") or "").upper()
    qty = money(p.get("quantity")) or ZERO
    state, filled, avg, oid = parse_fill(text)
    ledger = load_ledger()
    entry = {"tool": tool, "side": side, "symbol": symbol, "usd": f"{amt:.2f}",
             "ref_id": p.get("ref_id"), "order_id": oid, "state": state or "unknown"}

    if side == "buy":
        if os.path.exists(APPROVAL):
            a = json.load(open(APPROVAL))
            a["used"] = True
            a["used_ref_id"] = p.get("ref_id")
            json.dump(a, open(APPROVAL, "w"), indent=2)
        if filled and avg:
            apply_buy(ledger, symbol, filled, avg)
            entry["filled_shares"] = f"{filled}"
            entry["fill_price"] = f"{avg}"
            entry["usd"] = f"{filled * avg:.2f}"
            rest = qty - filled
            if rest > 0 and tool != "place_option_order":
                # Partial fill: reserve the unfilled shares at the order price.
                apply_buy(ledger, symbol, rest, amt / qty)
                entry["reserved_shares"] = f"{rest}"
        elif qty > 0 and tool != "place_option_order":
            # Resting buy: reserve at the order price until it fills or is cancelled.
            price = amt / qty
            apply_buy(ledger, symbol, qty, price)
            entry["pending_buy"] = False  # basis already counted in positions
            entry["note"] = "resting buy reserved at order price; correct with `fill` after the real fill"
        else:
            entry["pending_buy"] = True
    else:
        if state == "filled" and filled:
            released = apply_sell(ledger, symbol, filled)
            entry["released_usd"] = f"{released:.2f}"
            entry["filled_shares"] = f"{filled}"
            if avg:
                entry["fill_price"] = f"{avg}"
        else:
            entry["note"] = "sell placed, not filled; exposure unchanged until it fills"

    ledger["orders"].append(entry)
    recompute(ledger)
    save_ledger(ledger)


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def cli(argv):
    cmd = argv[0]
    cap = load_cap()
    ledger = load_ledger()
    if cmd == "status":
        exp = Decimal(str(ledger.get("exposure_usd", "0")))
        print(f"cap ${cap:.2f} | exposure ${exp:.2f} | remaining ${cap - exp:.2f} | orders {len(ledger['orders'])}")
        for sym, pos in sorted(ledger["positions"].items()):
            sh = Decimal(pos["shares"]); cost = Decimal(pos["cost_usd"])
            print(f"  {sym}: {sh.normalize()} sh, basis ${cost:.2f} (${cost / sh:.2f}/sh)")
    elif cmd == "fill":
        if len(argv) != 5:
            print("usage: fill SYMBOL buy|sell SHARES PRICE"); sys.exit(1)
        sym, side, sh, px = argv[1].upper(), argv[2].lower(), Decimal(argv[3]), Decimal(argv[4])
        if side == "buy":
            apply_buy(ledger, sym, sh, px)
        elif side == "sell":
            apply_sell(ledger, sym, sh)
        else:
            print("side must be buy or sell"); sys.exit(1)
        ledger["orders"].append({"tool": "manual", "side": side, "symbol": sym, "usd": f"{sh * px:.2f}",
                                 "filled_shares": f"{sh}", "fill_price": f"{px}", "state": "filled"})
        recompute(ledger)
        save_ledger(ledger)
        print("ok")
    elif cmd == "set-exposure":
        ledger["exposure_usd"] = f"{Decimal(argv[1]):.2f}"
        save_ledger(ledger)
        print("ok (note: `status` after the next order recomputes from positions)")
    elif cmd == "reset":
        save_ledger({"exposure_usd": "0", "positions": {}, "orders": []})
        print("ok")
    else:
        print(__doc__)
        sys.exit(1)


def main():
    if len(sys.argv) > 1:
        cli(sys.argv[1:])
        return

    try:
        event = json.load(sys.stdin)
        tool_name = event.get("tool_name", "")
        params = event.get("tool_input") or {}
        hook = event.get("hook_event_name", "PreToolUse")
        if hook == "PostToolUse":
            record(tool_name, params, event.get("tool_response"))
            return
        ok, reason = decide(tool_name, params)
        if not ok:
            deny(reason)
    except SystemExit:
        raise
    except Exception as e:  # fail closed
        deny(f"BLOCKED: trading cap hook error ({e}). Fix the hook before trading.")


if __name__ == "__main__":
    main()
