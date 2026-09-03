# Trading strategy (Claude follows this, no exceptions)

Fill every blank. A blank rule means no trade.

## 1. Purpose
Learning sandbox. $500 max. Never counted as income. Never scaled without a written decision from Coleman.

## 2. Universe (what Claude may even look at)
- Allowed: ___ (example: SPY, QQQ, and stocks over $10B market cap)
- Banned: penny stocks, leveraged ETFs, meme names, anything with earnings inside 7 days, all short or credit options.

## 3. Position rules
- Max positions open at once: ___ (start with 2)
- Max per position: $___ (start with $150)
- Cash always kept idle: $___ (start with $100)
- Options: buy to open only, limit price only, at least 30 days to expiry, max $___ per contract.

## 4. Entry (all must be true or no trade)
- Setup: ___ (example: price above 50 day average and pulling back to it)
- Confirmation: ___ (example: closes green on above average volume)
- Time: only during regular hours, never first or last 15 minutes.

## 5. Exit (set at entry, written in the proposal)
- Stop loss: ___% below entry (start with 8%)
- Target: ___% above entry (start with 15%)
- Time stop: close if flat after ___ trading days (start with 10)
- Options: close at 50% gain, 50% loss, or 7 days before expiry, whichever first.

## 6. Proposal format (Claude presents this, Coleman says yes or no)
Symbol, side, size in dollars, entry price, stop, target, time stop, reason in one line, cap room remaining. Then the review tool output. Then wait.

## 7. Review cadence
- Every session starts with: cap status, open positions, any stop or target hit.
- Weekly: total realized P&L, win rate, biggest loser, one rule to tighten.

## 8. Kill switch
Stop all new trades if any of these happen:
- Realized loss hits $___ (start with $250, half the cap)
- Three losers in a row
- Coleman says stop

## 9. Log
Every closed trade gets one line in `trades.md`: date, symbol, size, entry, exit, P&L, rule followed or broken.
