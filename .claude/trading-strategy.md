# Robinhood Sandbox Agent — Rulebook

Claude reads this file at the start of every session before touching the account. No trade gets proposed unless it passes all nine rules below. If any rule is unclear or unmet, Claude does not propose a trade — it says which rule failed.

## 1. Purpose
Sandbox account. $500 total. This capital is a testing ground for a rules-based process, not a source of income. It never enters an income projection, a budget, or a business plan. Losing all $500 is an acceptable, planned-for outcome of running the sandbox — it is not a business loss.

## 2. Universe
Allowed:
- US equities, S&P 500 constituents only
- BTC and ETH on Robinhood (capped speculation, per Rule 1 — never treated as income)

Banned, no exceptions:
- Options, futures, margin, leverage of any kind
- Leveraged or inverse ETFs
- Penny stocks (price under $5)
- OTC / pink sheet securities
- IPOs less than 30 calendar days old
- Any crypto other than BTC or ETH
- Any ticker or asset not on this list, even if it looks like a great setup — update this rule first, then trade it

## 3. Position Rules
- Maximum 3 open positions at any time
- Maximum $100 per position at entry
- Maximum $300 total deployed at any time — minimum $200 (40%) sits in cash at all times
- No two open positions may be in the same equity sector, and BTC + ETH together count as one "correlated slot," not two independent ones, for diversification purposes

## 4. Entry
Every condition below must be true. One false condition kills the trade — no override, no "close enough."

1. Ticker/asset is on the Rule 2 allowed list
2. Fewer than 3 positions currently open (Rule 3)
3. Entering this position does not drop idle cash below $200
4. No open position already exists in the same sector or correlated slot (Rule 3)
5. No earnings report scheduled within the next 3 trading days (equities)
6. Average daily volume supports entering and exiting $100 without meaningful slippage
7. A written thesis exists: the specific reason for this trade, one to three sentences, stated before entry — not filled in after
8. Stop, target, and time stop are all set and written down before the order is placed (Rule 5)

If Claude cannot check a condition (e.g., no live data on scheduled earnings), it says so and treats that condition as failed rather than assuming a pass.

## 5. Exit
Set at entry, before the order is placed. Never adjusted after the fact to avoid a loss or lock in more gain.

- Stop loss: -8% from entry price
- Profit target: +15% from entry price
- Time stop: close the position after 20 trading days regardless of price, if neither stop nor target has hit

Whichever of the three hits first governs the exit. No moving the stop further away once set.

Mechanics: Robinhood has no bracket order through this tool. After a buy fills, Claude proposes a good-till-cancelled sell stop at -8% in the same session and it goes in the ledger with the trade. The target and time stop are checked at every session start.

## 6. Proposal Format
Before any trade, Claude shows one block like this and waits for an explicit yes. No trade is placed on a maybe, a "looks good," or silence.

```
TRADE PROPOSAL
Ticker/Asset:
Direction: Buy
Entry price (approx):
Size: $___ (___ shares/units)
Stop: $___ (-8%)
Target: $___ (+15%)
Time stop: [date, 20 trading days out]
Thesis:
Rule 4 check: 1[pass/fail] 2[ ] 3[ ] 4[ ] 5[ ] 6[ ] 7[ ] 8[ ]
Cash after this trade: $___ of $500
Positions open after this trade: __ of 3
```

Claude waits for "yes" before placing anything. Silence, a question, or "let me think about it" is not a yes.

## 7. Review Cadence
- Session start: re-read this file, check the kill switch status (Rule 8) before proposing anything, review any open positions against their stop/target/time stop
- Weekly: review the log (Rule 9) — win rate, average win, average loss, whether the rules are actually being followed. Rules do not change mid-week because of one good or bad trade. Changes to this file happen deliberately, at a weekly review, in writing.

## 8. Kill Switch
Any one of these halts all trading immediately. Trading does not resume until Coleman reviews and explicitly restarts it — not automatically, not on a timer.

- Realized loss limit: total realized losses since account start reach -15% of $500 (-$75)
- Losing streak: 3 consecutive closed trades are losers, regardless of dollar total
- Manual stop: Coleman says stop, for any reason, at any time — no condition required

## 9. Log
One line per closed trade in `trades.md`. No trade is "done" until it's logged.

```
Date closed | Ticker | Direction | Entry $ | Exit $ | P/L $ | P/L % | Exit reason (stop/target/time) | Rules followed (Y/N)
```

Current status: $500 starting balance, 0 positions open, $0 realized loss against the $75 kill switch limit, 0-trade losing streak.
