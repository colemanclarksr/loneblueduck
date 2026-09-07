# Robinhood trading rules

Capped speculation. Hook-enforced: **$300 max deployed, $100 max per position, no options.** Numbers live in `.claude/robinhood-cap.json`.

## Governing strategy: `.claude/trading-role.md`

Read it at the start of every session. It is the ROLE. Everything below is procedure for running it inside the sandbox.

1. **Session start.** Regime filter first: SPY, QQQ, IWM against 21 EMA, 50 SMA, 200 SMA. Classify BULLISH / NEUTRAL / BEARISH and say it out loud. Then cap status (`python3 .claude/hooks/robinhood_cap.py status`), open positions, kill switch check from `trades.json`.
2. **Every candidate** goes through `python3 tools/sepa_score.py candidate.json`. Claude fills the JSON from live Robinhood data and gives a one line reason per sub-score. The tool prints the section 17 block. Status BUY requires score 80+, trend template pass, not extended past the pivot, stop 3-7%, no event risk, regime not BEARISH.
3. **Before any order:** run the review tool, show the section 17 block plus the broker quote disclosure, wait for an explicit "yes". Silence or a question is not a yes.
4. **Sizing:** 0.50% of $500 = $2.50 risk per trade default, $5.00 max. Shares = risk / (entry - stop), capped at $100. Recalculate off the actual fill. After a fill, propose the GTC sell stop in the same session.
5. **Buys must be priceable:** `dollar_amount`, or quantity with a limit or stop price. Plain market orders by share count are blocked by the hook.
6. **Exits:** thesis invalidation, stop, or winner management per ROLE section 12. Never widen a stop. Never average down.
7. **Journal:** `tools/journal.py open|close|review|list` writes `trades.json`. One line per closed trade in `trades.md` before the session ends. Post-win review is required on every winner.
8. **Kill switch:** $75 realized loss since start, 3 consecutive losers, or Coleman says stop. Halt until Coleman restarts in writing.
9. If an order was cancelled or failed after being recorded, correct the ledger with `set-exposure`.
10. Trading never appears in any income projection or business plan.

## Superseded documents (kept for reference)

- `.claude/trading-strategy.md`: the original nine rule sandbox rulebook. Its capital caps and kill switch live on above. Its 8% stop, 15% target, 20 day time stop, S&P 500 only universe, and crypto slot are replaced by the ROLE.
- `.claude/momentum-strategy-spec.md`: daily momentum spec. `tools/trade_check.py` implements it. Not governing. Its catalyst requirement and 2-3% stop do not apply under the ROLE.

Bull Bear Algo is not available through Robinhood. Manual input only.
