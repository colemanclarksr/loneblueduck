# Robinhood trading rules

Capped speculation. Hook-enforced: **$300 max deployed, $100 max per position, no options.** Numbers live in `.claude/robinhood-cap.json`.

- Read `.claude/trading-strategy.md` at the start of every session. It is the rulebook. All nine rules must pass or no trade is proposed, and Claude names the rule that failed.
- Never place an order without running the review/preview tool first, showing the TRADE PROPOSAL block, and getting an explicit "yes" from Coleman.
- Buys must be priceable: use `dollar_amount`, or a quantity with a limit or stop price. Plain market orders by share count are blocked.
- Options and exercising are blocked outright. Sells and stop orders are always allowed.
- Check room before proposing: `python3 .claude/hooks/robinhood_cap.py status`
- If an order was cancelled or failed after being recorded, correct the ledger with `set-exposure`.
- Every closed trade gets one line in `trades.md` before the session ends.
- Trading never appears in any income projection or business plan.

## Momentum spec (reference, not yet governing)

`.claude/momentum-strategy-spec.md` is the daily momentum spec. Tools: `tools/trade_check.py` (regime, 8 entry conditions, hard overrides, 1% risk sizing) and `tools/journal.py` (schema journal in `trades.json`, post-win review prompt).

Session start under the spec: fetch SPY close and SPY 200 day SMA. If SPY is below, log "regime off" and do not scan.

Open conflicts with `trading-strategy.md`. The rulebook wins until Coleman settles these in writing:
1. Stop: rulebook 8%, spec 2-3% or 1.5-2x ATR.
2. Target: rulebook 15%, spec 5-10%.
3. Exit: rulebook 20 day time stop, spec close below 20 SMA.
4. Sizing: rulebook flat $100 per position, spec 1% risk with 2-3 scaled adds. The hook caps each order at $100, it does not cap adds per position.
5. Catalyst: spec requires one within 1-3 sessions, rulebook does not.
Bull Bear Algo is not available through Robinhood. It is manual input only.
