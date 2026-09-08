# ROBINHOOD EXECUTION GUARD

ACCOUNT: $1,000 starting equity. STRATEGY: Mark Minervini-inspired SEPA/VCP momentum trading.

PURPOSE: This is the FINAL safety layer between the trading system and Robinhood. The scanner identifies opportunities. The Buy/Hold/Sell Engine determines the desired action. THIS GUARD determines whether an order is actually permitted. NO OTHER COMPONENT MAY BYPASS THIS GUARD.

Implementation: `tools/guard.py` produces the section 24 decision and, on APPROVED, writes a single-use approval (`.claude/guard-approval.json`, 15 minute expiry) for one ticker, share count, and max limit price. The PreToolUse hook refuses any buy without a matching live approval. Sells are always allowed.

## 1. PRIMARY RULE
DEFAULT ACTION = DO NOTHING. An order is permitted only after every required safety check passes. If data is missing, stale, contradictory, or unverifiable: BLOCK ORDER. Never guess.

## 2. REFRESH LIVE DATA
Immediately before every order retrieve fresh: current account equity, cash available, buying power, current positions, open orders, current bid, current ask, last price, current volume, pivot, technical stop, next earnings date, market status. Never rely solely on the scanner's earlier quote.

## 3. ACCOUNT RISK
NORMAL MAXIMUM PLANNED RISK: 0.75% of CURRENT ACCOUNT EQUITY. MAX_RISK = ACCOUNT_EQUITY × 0.0075 ($1,000 = $7.50, $900 = $6.75, $1,100 = $8.25, $1,500 = $11.25). Risk must scale with CURRENT equity, not original equity.

## 4. DRAWDOWN RISK OVERRIDE
Track account equity high. Drawdown <3%: risk 0.75%. 3–5%: 0.50%. 5–8%: 0.25%. >=8%: BLOCK ALL NEW POSITIONS. Existing positions may only be HOLD, TRIM, SELL.

## 5. MARKET OVERRIDE
GREEN: new A/A+ positions permitted. YELLOW: only A/A+ positions, maximum risk 0.50%. RED: BLOCK NEW LONG POSITIONS. Do not override because an individual stock looks attractive.

## 6. VALIDATE BUY SIGNAL
Before accepting BUY confirm: Momentum Score >=85, Grade A or A+, Minervini Trend Template passes, relative strength STRONG, valid technical setup exists, specific pivot exists, technical stop exists, reward/risk >=2:1, earnings filter passes, market filter passes. If any mandatory condition fails: BLOCK BUY.

## 7. LIVE PIVOT CHECK
EXTENSION = (CURRENT_PRICE - PIVOT) / PIVOT × 100. 0–2%: BUY permitted. 2–3%: only A+ setup. 3–5%: BLOCK BUY, return WATCH. >5%: BLOCK BUY, return EXTENDED — DO NOT CHASE. Never chase because the stock is moving rapidly.

## 8. SPREAD CHECK (amended by Coleman 2026-09-04)
SPREAD % = (ASK - BID) / MIDPOINT × 100. Always reported. A wide spread does not reject the trade. If spread >1%: market orders are blocked, a limit order at or below the entry zone top is required. Position sizing already accounts for the spread through the entry price.

## 9. EARNINGS CHECK
If earnings <=5 trading days away: BLOCK NEW BUY, return WATCH — EARNINGS RISK. If earnings date cannot be verified: BLOCK BUY.

## 10. POSITION SIZE
RISK_PER_SHARE = PROPOSED_ENTRY - STOP. If risk/share <=0: BLOCK ORDER. RISK_SHARES = floor(MAX_RISK / RISK_PER_SHARE). CASH_SHARES = floor(AVAILABLE_CASH / PROPOSED_ENTRY). FINAL_SHARES = min(RISK_SHARES, CASH_SHARES). If FINAL_SHARES <1: BLOCK ORDER. Do NOT widen stop, increase risk, or use margin.

## 11. POSITION CONCENTRATION
Preferred initial position <=25% of account equity. A position may exceed 25% only when specifically permitted by portfolio rules AND total dollar risk remains below the risk ceiling. Never confuse POSITION SIZE with ACCOUNT RISK. A $250 position does not mean $250 is at risk.

## 12. DUPLICATE ORDER CHECK
Before sending ANY order search open orders, pending orders, existing position, recent executions. If a substantially identical order already exists: BLOCK DUPLICATE. Never accidentally double-enter.

## 13. BUY ORDER
Prefer controlled LIMIT orders around the planned entry. Do not blindly submit a market order during large spread, opening volatility, trading halt, abnormal price spike, fast-moving gap, unverified quote conditions. If price moves beyond permitted entry zone before fill: CANCEL remaining order. DO NOT CHASE.

## 14. AFTER FILL
Immediately retrieve ACTUAL fill. Recalculate actual entry, risk/share, stop distance, actual dollar risk, position value. If actual fill materially changes planned risk: reassess immediately. A BUY is not complete until risk protection is established.

## 15. PROTECTIVE STOP
After confirmed entry ensure protective exit logic exists at the predefined technical stop. NEVER move stop downward, delete protection because price approaches stop, or increase acceptable loss after entry. The trade either works or it doesn't.

## 16. FAILED BREAKOUT
The hard stop is NOT permission to ignore obvious failure. If after entry price falls below pivot, breakout fails, heavy selling develops, RS deteriorates materially, price closes poorly, or the original thesis breaks, the Decision Engine may issue SELL EARLY. A 2–3% loss can be preferable to waiting for the maximum stop.

## 17. HOLD
HOLD if trend remains healthy, thesis intact, price/volume constructive, no technical sell rule triggered. Do not sell solely because position is green. Do not micromanage ordinary fluctuations.

## 18. PROFIT PROTECTION
1R = original entry - original stop. +1R: HOLD healthy leader. +2R: activate PROFIT PROTECTION. +3R: do not normally permit the position to become a full-size loss. +4R or greater: trail according to technical structure. Exceptional leaders should be allowed to continue.

## 19. TRIM
Permit TRIM on parabolic extension, climactic volume, abnormal reversal, technical overextension, or materially rising risk of giving back substantial profit. Typical trim 25–50%. Never trim merely because a predefined small percentage gain was reached.

## 20. SELL
SELL overrides BUY/HOLD when hard stop triggers, technical setup fails, breakout fails decisively, abnormal distribution develops, or the original thesis is invalidated. Never delay a required SELL hoping price recovers. NEVER AVERAGE DOWN.

## 21. DAILY KILL SWITCH
If realized losses for one trading day reach 1.5% of account equity ($15 at $1,000): BLOCK ALL NEW BUYS FOR THE REST OF THE DAY. Existing positions may still be reduced or sold. Never revenge trade.

## 22. CONSECUTIVE LOSS RULE
After 3 consecutive losing trades: BLOCK new trades temporarily. Re-evaluate market regime, recent setups, entry quality, breakout success rate, execution, average loss, average winner. Resume at reduced 0.50% account risk until a profitable trade confirms improved conditions.

## 23. NO AVERAGING DOWN
ABSOLUTE RULE: if position price falls below entry, DO NOT ADD BECAUSE PRICE IS CHEAPER. Additional purchases require the existing trade working, a new valid setup, a separate low-risk entry, and total portfolio risk within limits.

## 24. ORDER DECISION
Before every proposed order return: TICKER, REQUESTED ACTION, GUARD DECISION (APPROVED / BLOCKED), CURRENT PRICE, BID, ASK, SPREAD, PIVOT, EXTENSION FROM PIVOT, ENTRY, STOP, STOP %, ACCOUNT EQUITY, ACCOUNT DRAWDOWN, CURRENT RISK LIMIT, MAX DOLLAR RISK, RISK/SHARE, SHARES, POSITION VALUE, MARKET REGIME, MOMENTUM SCORE, GRADE, EARNINGS DATE, EXISTING POSITION, OPEN ORDER, REWARD/RISK, REASON.

## 25. FINAL AUTHORIZATION
Only send BUY when GUARD DECISION = APPROVED AND every mandatory field has been verified using current data. If blocked: DO NOT SEND ORDER. State exactly why: BLOCKED — PRICE EXTENDED, EARNINGS RISK, RISK TOO HIGH, RED MARKET, DUPLICATE ORDER, SPREAD TOO WIDE, INSUFFICIENT BUYING POWER, DRAWDOWN LIMIT, DATA NOT VERIFIED.

## 26. PRIME DIRECTIVE
The guard exists to say NO. Missing a trade costs nothing. Breaking risk discipline can cost capital. Never chase. Never average down. Never widen stops. Never revenge trade. Never exceed risk limits. Never fabricate data. Never override a safety rule because of confidence. PROTECT THE ACCOUNT FIRST.
