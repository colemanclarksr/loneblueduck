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
