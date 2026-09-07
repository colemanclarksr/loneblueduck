# MINERVINI-STYLE BUY / HOLD / SELL ENGINE

STARTING ACCOUNT EQUITY: $1,000

STRATEGY: SEPA / VCP momentum swing trading inspired by Mark Minervini.

PRIMARY GOAL: Compound capital by buying leading stocks at low-risk entry points, cutting losses quickly, and allowing strong winners to become meaningfully larger than average losers. Never trade merely to stay active. CASH IS A POSITION.

## ACCOUNT RISK
BASE RISK PER TRADE: 0.75% of CURRENT account equity. At $1,000: MAXIMUM PLANNED LOSS = $7.50. As account equity changes, recalculate automatically ($1,100 = $8.25, $1,250 = $9.38, $1,500 = $11.25, $2,000 = $15.00). Never increase risk simply because a trade appears certain.

## POSITION SIZE
The chart determines the stop FIRST. Then calculate position size.
RISK PER SHARE = ENTRY PRICE - STOP PRICE
RISK-BASED SHARES = ACCOUNT RISK / RISK PER SHARE
CAPITAL-BASED SHARES = AVAILABLE CASH / ENTRY PRICE
FINAL SHARES = floor(min(RISK-BASED SHARES, CAPITAL-BASED SHARES))
Never use margin. Never average down.

## NORMAL POSITION SIZE
Preferred initial position: approximately 20–25% of account equity. For $1,000: $200–$250. Exceptional setup may justify a larger position ONLY when the technical stop allows account risk to remain within the $7.50 risk budget. Do not distort the stop just to obtain a larger position.

## BUY
Return BUY only when the stock meets the required momentum criteria AND is currently at a valid entry.
Trend requirements: Price > 50 SMA, Price > 150 SMA, Price > 200 SMA, 50 SMA > 150 SMA, 150 SMA > 200 SMA, 200 SMA trending upward. Prefer price near its 52-week high. Relative strength must be strong. The stock should be outperforming the broad market and preferably its industry.
Look for: VCP, tight consolidation, flat base, constructive pullback, high-tight flag, power play, post-earnings consolidation.
Prefer: contracting volatility, contracting selling volume, tighter price action, strong relative strength, increasing institutional demand, strong earnings/revenue growth.

## ENTRY
Identify a specific PIVOT before buying. Ideal entry: at or immediately above the pivot as price confirms the breakout. Do not chase.
0–2% above pivot: BUY permitted if all other conditions pass.
2–3%: BUY only for exceptional setup.
3–5%: WATCH.
More than 5%: DO NOT BUY. Wait for another setup.

## VOLUME
Prefer breakout volume significantly above normal. Strong volume confirms demand. A breakout occurring on weak volume receives a lower score and may remain WATCH instead of BUY.

## INITIAL STOP
Determine stop from technical structure. Preferred stop: approximately 3–6% below entry. Ideal: 4–5%. Maximum normal stop: 8%. Stop should preferably sit beneath: recent contraction low, pivot support, higher low, logical technical invalidation. If the correct technical stop requires excessive risk: PASS ON THE TRADE. Never widen a stop after entering.

## EARLY FAILURE RULE
Do NOT automatically wait for the hard stop. If a breakout immediately fails: SELL EARLY. Warning signs: price falls back below pivot, heavy selling volume appears, relative strength deteriorates, breakout cannot hold, stock closes poorly after breakout, price action contradicts original thesis. A 2–3% loss is better than unnecessarily taking a 6% loss.

## HOLD
Return HOLD when: position is profitable or behaving normally, trend remains intact, price remains technically healthy, relative strength remains strong, volume behavior remains constructive, no sell signal has occurred.
Do NOT sell merely because: stock gains 3%, stock gains 5%, stock has one red day, stock pulls back normally, stock touches a short-term moving average. Give strong stocks room to work.

## R MULTIPLE
1R = original risk per share. Example: Entry $25.00, Stop $23.75, Risk $1.25/share. 1R = $26.25, 2R = $27.50, 3R = $28.75, 4R = $30.00. Track every position in R multiples. The goal is for average winners to substantially exceed average losers.

## WINNER MANAGEMENT
0R to +1R: HOLD if technically healthy. Do not take tiny profits simply because the stock is green.
+1R to +2R: HOLD strong stocks. Monitor price/volume behavior.
+2R: Begin PROFIT PROTECTION MODE. Do not automatically sell. Consider moving stop upward if technically justified.
+3R: Winner should receive increased protection. Normally do not allow a +3R trade to become a full loss.
+4R and above: Continue holding exceptional leaders while trend remains intact. Use technical trailing stops. Do NOT impose an arbitrary upside target on an exceptional stock.

## TRIM
Return TRIM when a profitable stock becomes abnormally extended: parabolic move, climactic volume, large price extension from moving averages, multiple unusually large daily gains, major reversal after strong advance, exhaustion gap, extreme short-term extension. Default TRIM: 25–50% of position. Continue holding remainder if trend remains healthy.

## SELL
Return SELL when ANY major invalidation occurs: hard stop reached, technical setup fails, breakout decisively fails, abnormal high-volume reversal, major support breaks, relative strength collapses, price action demonstrates significant distribution, original trade thesis is no longer valid.
NEVER: average down, move stop lower, turn a momentum trade into a long-term investment because it lost money.

## ADDING TO WINNERS
Only add when: original position is profitable, stock proves itself, another valid low-risk entry develops, total account risk remains acceptable. Never add because the stock fell. PYRAMID INTO STRENGTH. NEVER PYRAMID INTO WEAKNESS.

## MARKET EXPOSURE
GREEN: indexes healthy, breakouts working, existing positions profitable. Normal risk 0.75% equity. Allow new A/A+ setups.
YELLOW: mixed market, breakouts inconsistent. Reduce new positions. Require exceptional setups. Risk 0.50% equity.
RED: major indexes weak, breakouts repeatedly failing, existing positions triggering stops. NO NEW LONG POSITIONS. Raise cash. The account does not need to be invested.

## PROGRESSIVE EXPOSURE
Increase exposure only after the market proves the strategy is working. If recent trades are failing: TRADE SMALLER. If multiple positions are working: allow normal exposure. Never respond to losses by increasing position size.

## DRAWDOWN PROTECTION
If account falls 3% from equity high: reduce risk to 0.50%.
If account falls 5%: reduce risk to 0.25%.
If account falls 8%: STOP NEW LIVE TRADES. Review strategy and recent trades before resuming.
Never revenge trade.

## EARNINGS
Check earnings date BEFORE every purchase. If earnings are within 5 trading days: default WATCH / NO NEW POSITION. Do not expose this small account to an unknown earnings gap unless specifically authorized.

## DECISION ENGINE
Every analyzed stock MUST receive exactly one status:
BUY: valid Minervini-style setup and valid entry exists NOW.
WATCH: high-quality stock/setup but entry is not currently valid.
HOLD: already owned and position remains technically healthy.
TRIM: profitable position has become excessively extended or shows warning signs.
SELL: stop or technical invalidation has occurred.
REJECT: stock does not meet momentum/SEPA requirements.

## BEFORE EVERY BUY
Output: TICKER, CURRENT PRICE, ACTION, SETUP, MOMENTUM SCORE /100, GRADE, PIVOT, ENTRY PRICE, DISTANCE FROM PIVOT %, STOP, STOP DISTANCE %, RISK PER SHARE, CURRENT ACCOUNT EQUITY, ACCOUNT RISK %, MAXIMUM DOLLAR LOSS, SHARES, POSITION VALUE, % OF ACCOUNT, 1R PRICE, 2R PRICE, 3R PRICE, MARKET (GREEN/YELLOW/RED), RELATIVE STRENGTH, VOLUME (CONFIRMED / NOT CONFIRMED), EARNINGS DATE, THESIS, INVALIDATION.

## EXECUTION SAFETY
Immediately before execution, refresh: current quote, account equity, available buying power, existing positions, open orders, pivot, stop, earnings date, position size. Never fabricate unavailable data. If critical information cannot be verified: DATA INSUFFICIENT — NO TRADE.

## FINAL RULE
Think RISK FIRST. FIND LEADER → IDENTIFY SETUP → IDENTIFY PIVOT → DEFINE STOP → CALCULATE RISK → CALCULATE POSITION SIZE → WAIT FOR CONFIRMATION → BUY → CUT FAILURE QUICKLY → HOLD HEALTHY WINNER → PROTECT LARGE WINNER → SELL WHEN THESIS BREAKS.
Never average down. Never chase. Never widen a stop. Never revenge trade. Never force a trade. Protect capital first.
The objective is not to be right on every trade. The objective is: SMALL LOSSES + CONTROLLED RISK + LARGE WINNERS. LONG-TERM COMPOUNDING.
