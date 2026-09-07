# Robinhood trading rules

Capped speculation. Hook-enforced: **$1,000 max deployed (cash only, no margin), $250 max per order, no options.** Numbers live in `.claude/robinhood-cap.json`.

## Governing documents, in order

1. `.claude/trading-guard.md`: execution guard. Final gate before any buy. **Hook-enforced: no buy reaches Robinhood without a live guard approval.**
2. `.claude/trading-engine.md`: Buy/Hold/Sell engine. Risk, sizing, entry, stops, R multiples, winner management, market color, drawdown tiers. **Where numbers conflict, this file wins.**
3. `.claude/trading-scanner.md`: daily scan procedure, top five ranking, decision board.
4. `.claude/trading-role.md`: the philosophy and prime directive behind all of it.

Read all four at session start. Superseded and kept for reference only: `.claude/trading-strategy.md` (original nine rule sandbox rulebook) and `.claude/momentum-strategy-spec.md` (daily momentum spec, `tools/trade_check.py`).

## Procedure

1. **Session start.** Regime: SPY, QQQ, IWM against 21 EMA, 50 SMA, 200 SMA. Classify GREEN / YELLOW / RED and say it. Then cap status (`python3 .claude/hooks/robinhood_cap.py status`), portfolio equity and cash from Robinhood, open positions, open orders, `trades.json`.
2. **Account file.** Write `account.json` each session with live numbers: equity, cash, equity_high, market, as_of. Never carry yesterday's.
3. **Scan.** Universe: price >= $10, dollar volume >= $25M. Trend template first, then setup, pivot, stop, earnings, catalyst. Fill one candidate JSON per survivor with a one line reason per sub-score. Max five.
4. **Engine.** `python3 tools/engine.py board c1.json c2.json ... --account account.json` prints the section 16 blocks and the decision board. `candidate` for one. `r ENTRY STOP PRICE` for any open position.
5. **BUY NOW requires:** trend template pass, grade A or A+ (A+ only in YELLOW), 0-2% above pivot (2-3% needs A+), stop 3-8%, volume CONFIRMED, no earnings inside 5 trading days, room to 2R, at least 1 whole share inside the risk budget, market not RED, drawdown under 8%.
6. **Before any buy, in this order:** refresh quote, bid, ask, equity, cash, buying power, positions, open orders, earnings date, market status. Write `order.json` with a `fetched_at` timestamp. Run `python3 tools/guard.py order.json`. BLOCKED means stop and state the reason verbatim. APPROVED writes a single use approval good for 15 minutes for that ticker, share count, and max limit price. Then run the review tool, show the guard block plus the broker quote disclosure, and wait for an explicit "yes". Recalculate off the real fill. Propose the GTC sell stop in the same session. The hook refuses any buy that does not match a live approval, and burns the approval on fill.
7. **Orders:** buys are limit orders at or below the guard's zone top, whole shares. Market orders only when the guard approved that type. Crypto is blocked. Sells and stops always allowed.
8. **Owned positions** get exactly one status every session: HOLD, TRIM, SELL. Early failure rule applies, do not wait for the hard stop when a breakout fails.
9. **Journal.** `tools/journal.py open|close|review|list` writes `trades.json`. One line per closed trade in `trades.md`. Post-win review on every winner. Track R multiples.
10. **Halt** on 8% drawdown from equity high, 1.5% realized loss in one day, 3 consecutive losers, or when Coleman says stop. Resume only after a written review, at 0.50% risk until a winner confirms.
11. Ledger corrections after a cancel or failed fill: `robinhood_cap.py set-exposure`.
12. Trading never appears in any income projection or business plan.

Bull Bear Algo is not available through Robinhood. Manual input only.
