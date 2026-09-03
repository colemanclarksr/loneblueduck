#!/usr/bin/env python3
"""Hard dollar cap on Robinhood MCP trading tools.

Runs as a Claude Code PreToolUse hook (blocks orders that would push open
exposure past the cap) and PostToolUse hook (records placed orders in a
ledger). Fails closed: anything the hook cannot price is denied.

CLI:
  robinhood_cap.py status                 show cap, exposure, remaining
  robinhood_cap.py set-exposure <usd>     correct the ledger (cancel, bad fill)
  robinhood_cap.py reset                  zero the ledger
"""
import json
import os
import sys
from decimal import Decimal, InvalidOperation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "robinhood-cap.json")
LEDGER = os.path.join(ROOT, "robinhood-cap-ledger.json")

ORDER_TOOLS = ("place_equity_order", "place_option_order", "place_crypto_order")
EXERCISE_TOOL = "exercise_option"


def money(v):
    try:
        d = Decimal(str(v))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return d if d > 0 else None


def load_cap():
    with open(CONFIG) as f:
        return Decimal(str(json.load(f)["cap_usd"]))


def load_ledger():
    if not os.path.exists(LEDGER):
        return {"exposure_usd": "0", "orders": []}
    with open(LEDGER) as f:
        return json.load(f)


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
            return "sell", Decimal("0"), None
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


def decide(tool_name, p):
    tool = short_name(tool_name)
    cap = load_cap()
    ledger = load_ledger()
    exposure = Decimal(str(ledger.get("exposure_usd", "0")))
    remaining = cap - exposure

    if tool == EXERCISE_TOOL:
        return False, f"BLOCKED by ${cap} trading cap: exercising options requires cash beyond the cap. Sell to close instead."

    side, amt, why = notional(tool, p)
    if side == "sell":
        return True, None
    if amt is None:
        return False, f"BLOCKED by ${cap} trading cap: {why}."
    if amt > remaining:
        return False, (
            f"BLOCKED by ${cap} trading cap: this order is ${amt:.2f}, open exposure is "
            f"${exposure:.2f}, remaining room is ${remaining:.2f}. Reduce the order or sell something first."
        )
    return True, None


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
        amt = Decimal("0")
    ledger = load_ledger()
    exposure = Decimal(str(ledger.get("exposure_usd", "0")))
    exposure = exposure + amt if side == "buy" else max(Decimal("0"), exposure - amt)
    ledger["exposure_usd"] = f"{exposure:.2f}"
    ledger.setdefault("orders", []).append(
        {"tool": tool, "side": side, "symbol": p.get("symbol"), "usd": f"{amt:.2f}", "ref_id": p.get("ref_id")}
    )
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


def main():
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        cap = load_cap()
        ledger = load_ledger()
        if cmd == "status":
            exp = Decimal(str(ledger.get("exposure_usd", "0")))
            print(f"cap ${cap:.2f} | exposure ${exp:.2f} | remaining ${cap - exp:.2f} | orders {len(ledger.get('orders', []))}")
        elif cmd == "set-exposure":
            ledger["exposure_usd"] = f"{Decimal(sys.argv[2]):.2f}"
            save_ledger(ledger)
            print("ok")
        elif cmd == "reset":
            save_ledger({"exposure_usd": "0", "orders": []})
            print("ok")
        else:
            print(__doc__)
            sys.exit(1)
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
