# Robinhood trading rules

Capped speculation. Hard cap: **$500 open exposure**, enforced by a hook, not by judgment.

- Never place an order without running the review/preview tool first and getting an explicit yes from Coleman.
- Buys must be priceable: use `dollar_amount`, or a quantity with a limit or stop price. Plain market orders by share count are blocked.
- Options: buy-to-open with a limit price only. No short or credit positions. No exercising. Closing orders are always allowed.
- Sells are always allowed.
- Check room before proposing a trade: `python3 .claude/hooks/robinhood_cap.py status`
- If an order was cancelled or failed after being recorded, correct the ledger with `set-exposure`.
- Trading never appears in any income projection or business plan.
- Strategy rules live in `.claude/trading-strategy.md`. Read it before proposing any trade. A blank rule means no trade.
