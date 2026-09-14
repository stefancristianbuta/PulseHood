import fs from 'node:fs';

const path = 'src/trading-runtime.ts';
const MIN_NET_EDGE_USD = Math.max(0, Number(process.env.PAPER_MIN_NET_EDGE_USD ?? 1.5));
const ROUND_TRIP_COST_BUFFER = Math.max(1, Number(process.env.PAPER_ROUND_TRIP_COST_BUFFER ?? 1.15));
const MIN_HOLD_MS = Math.max(0, Number(process.env.PAPER_MIN_HOLD_MS ?? 60_000));
const MAX_HOLD_MS = Math.max(MIN_HOLD_MS, Number(process.env.PAPER_MAX_HOLD_MS ?? 15 * 60_000));
const HARD_STOP_PCT = Math.max(0.5, Number(process.env.PAPER_HARD_STOP_PCT ?? 2.5));
let s = fs.readFileSync(path, 'utf8');

const anchor = "const MARKET_CACHE_TTL_MS = 750;";
if (!s.includes(anchor)) throw new Error('strategy anchor not found');
s = s.replace(anchor, `${anchor}\nconst MIN_NET_EDGE_USD = Math.max(0, Number(process.env.PAPER_MIN_NET_EDGE_USD ?? 1.5));\nconst ROUND_TRIP_COST_BUFFER = Math.max(1, Number(process.env.PAPER_ROUND_TRIP_COST_BUFFER ?? 1.15));\nconst MIN_HOLD_MS = Math.max(0, Number(process.env.PAPER_MIN_HOLD_MS ?? 60_000));\nconst MAX_HOLD_MS = Math.max(MIN_HOLD_MS, Number(process.env.PAPER_MAX_HOLD_MS ?? 15 * 60_000));\nconst HARD_STOP_PCT = Math.max(0.5, Number(process.env.PAPER_HARD_STOP_PCT ?? 2.5));`);

const oldQuoteGate = "const best = chooseBestQuote([this.makePaperQuote(swap.targetToken, market.priceUsd, market.liquidityUsd, this.entrySizeUsd)]);\n    if (best === undefined) { this.reject(swap, 'no_executable_quote'); return; }";
const newQuoteGate = `const best = chooseBestQuote([this.makePaperQuote(swap.targetToken, market.priceUsd, market.liquidityUsd, this.entrySizeUsd)]);\n    if (best === undefined) { this.reject(swap, 'no_executable_quote'); return; }\n    const entryCostUsd = best.quote.dexFeeUsd + best.quote.slippageUsd + best.quote.priceImpactUsd + (Number(best.quote.gasEstimate * best.quote.gasPriceWei) / 1e18) * best.quote.nativeTokenUsd;\n    const estimatedExitAmountUsd = Math.max(0, this.entrySizeUsd - entryCostUsd);\n    const estimatedExit = this.makePaperQuote(swap.targetToken, market.priceUsd, market.liquidityUsd, estimatedExitAmountUsd, estimatedExitAmountUsd);\n    const estimatedRoundTripCostUsd = entryCostUsd + estimatedExit.dexFeeUsd + estimatedExit.slippageUsd + estimatedExit.priceImpactUsd + (Number(estimatedExit.gasEstimate * estimatedExit.gasPriceWei) / 1e18) * estimatedExit.nativeTokenUsd;\n    const requiredMovePct = ((estimatedRoundTripCostUsd * ROUND_TRIP_COST_BUFFER + MIN_NET_EDGE_USD) / Math.max(this.entrySizeUsd, 1)) * 100;\n    if (flow.priceChangePct < requiredMovePct) { this.reject(swap, 'edge_below_round_trip_cost', { priceChangePct: flow.priceChangePct, requiredMovePct, estimatedRoundTripCostUsd, entryCostUsd, minNetEdgeUsd: MIN_NET_EDGE_USD }); return; }`;
if (!s.includes(oldQuoteGate)) throw new Error('entry quote gate not found');
s = s.replace(oldQuoteGate, newQuoteGate);

s = s.replace(
  "this.positionMarkets.set(position.id, { protocol: swap.protocol ?? V2_PROTOCOL, pool: swap.pool, quote: swap.quoteToken as Addr });",
  "this.positionMarkets.set(position.id, { protocol: swap.protocol ?? V2_PROTOCOL, pool: swap.pool, quote: swap.quoteToken as Addr, entryCostUsd });",
);

const oldMark = "const pnlUsd = update.position.entryPriceUsd > 0 ? update.position.sizeUsd * ((update.position.currentPriceUsd / update.position.entryPriceUsd) - 1) : 0;\n      const pnlPct = update.position.entryPriceUsd > 0 ? ((update.position.currentPriceUsd / update.position.entryPriceUsd) - 1) * 100 : 0;";
const newMark = `const pnlUsd = update.position.entryPriceUsd > 0 ? update.position.sizeUsd * ((update.position.currentPriceUsd / update.position.entryPriceUsd) - 1) : 0;\n      const pnlPct = update.position.entryPriceUsd > 0 ? ((update.position.currentPriceUsd / update.position.entryPriceUsd) - 1) * 100 : 0;\n      const ageMs = Math.max(0, Date.now() - update.position.openedAt);\n      const entryCostUsd = marketRef.entryCostUsd;\n      const exitProbe = this.makePaperQuote(position.token, market.priceUsd, market.liquidityUsd, update.position.sizeUsd, Math.max(0, update.position.sizeUsd + pnlUsd));\n      const estimatedExitCostUsd = exitProbe.dexFeeUsd + exitProbe.slippageUsd + exitProbe.priceImpactUsd + (Number(exitProbe.gasEstimate * exitProbe.gasPriceWei) / 1e18) * exitProbe.nativeTokenUsd;\n      const estimatedNetPnlUsd = pnlUsd - entryCostUsd - estimatedExitCostUsd;\n      const takeProfitReady = estimatedNetPnlUsd >= MIN_NET_EDGE_USD;\n      const hardStop = pnlPct <= -HARD_STOP_PCT;\n      const maxHold = ageMs >= MAX_HOLD_MS;\n      const deteriorationExit = update.decision.action === 'SELL' && ageMs >= MIN_HOLD_MS && (estimatedNetPnlUsd >= 0 || hardStop || maxHold);`;
if (!s.includes(oldMark)) throw new Error('mark block not found');
s = s.replace(oldMark, newMark);

s = s.replace(
  "if (update.decision.action !== 'SELL') continue;",
  "if (!takeProfitReady && !hardStop && !maxHold && !deteriorationExit) continue;",
);

s = s.replace(
  "const netPnlUsd = exitValueUsd - position.sizeUsd;",
  "const netPnlUsd = exitValueUsd - position.sizeUsd - entryCostUsd;",
);

s = s.replace(
  "payload: { positionId: position.id, currentPriceUsd: update.position.currentPriceUsd, pnlUsd, pnlPct, state: update.position.state, momentum, momentumPeak: update.position.momentumPeak, volumeAcceleration: flow?.volumeAccelerationPct ?? 0, exitAction: update.decision.action, exitReason: update.decision.reason }",
  "payload: { positionId: position.id, currentPriceUsd: update.position.currentPriceUsd, pnlUsd, pnlPct, state: update.position.state, momentum, momentumPeak: update.position.momentumPeak, volumeAcceleration: flow?.volumeAccelerationPct ?? 0, exitAction: update.decision.action, exitReason: update.decision.reason, ageMs, entryCostUsd, estimatedExitCostUsd, estimatedNetPnlUsd, takeProfitReady, hardStop, maxHold }",
);

s = s.replace(
  "console.log(JSON.stringify({ event: 'paper_exit', positionId: position.id, priceUsd: market.priceUsd, pnlUsd: netPnlUsd, pnlPct: netPnlPct, grossPnlUsd: pnlUsd, exitCostUsd: sell.fill.cost.totalUsd, reason: update.decision.reason }));",
  "console.log(JSON.stringify({ event: 'paper_exit', positionId: position.id, priceUsd: market.priceUsd, pnlUsd: netPnlUsd, pnlPct: netPnlPct, grossPnlUsd: pnlUsd, entryCostUsd, exitCostUsd: sell.fill.cost.totalUsd, reason: takeProfitReady ? 'take_profit' : hardStop ? 'hard_stop' : maxHold ? 'max_hold' : update.decision.reason }));",
);

fs.writeFileSync(path, s);
console.log(JSON.stringify({ event: 'strategy_patch', minNetEdgeUsd: MIN_NET_EDGE_USD, roundTripCostBuffer: ROUND_TRIP_COST_BUFFER, minHoldMs: MIN_HOLD_MS, maxHoldMs: MAX_HOLD_MS, hardStopPct: HARD_STOP_PCT, source: path }));
