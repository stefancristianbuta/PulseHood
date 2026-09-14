import fs from 'node:fs';

const path = 'src/trading-runtime.ts';
const MIN_NET_EDGE_USD = Math.max(0, Number(process.env.PAPER_MIN_NET_EDGE_USD ?? 1.5));
const ROUND_TRIP_COST_BUFFER = Math.max(1, Number(process.env.PAPER_ROUND_TRIP_COST_BUFFER ?? 1.25));
const MIN_HOLD_MS = Math.max(0, Number(process.env.PAPER_MIN_HOLD_MS ?? 20_000));
const MAX_HOLD_MS = Math.max(MIN_HOLD_MS, Number(process.env.PAPER_MAX_HOLD_MS ?? 3 * 60_000));
const NET_HARD_STOP_USD = Math.max(1, Number(process.env.PAPER_NET_HARD_STOP_USD ?? 4));
const EARLY_EXIT_MS = Math.max(MIN_HOLD_MS, Number(process.env.PAPER_EARLY_EXIT_MS ?? 45_000));
let s = fs.readFileSync(path, 'utf8');

const anchor = 'const MARKET_CACHE_TTL_MS = 750;';
if (!s.includes(anchor)) throw new Error('strategy anchor not found');

const constants = `const MIN_NET_EDGE_USD = Math.max(0, Number(process.env.PAPER_MIN_NET_EDGE_USD ?? 1.5));\nconst ROUND_TRIP_COST_BUFFER = Math.max(1, Number(process.env.PAPER_ROUND_TRIP_COST_BUFFER ?? 1.25));\nconst MIN_HOLD_MS = Math.max(0, Number(process.env.PAPER_MIN_HOLD_MS ?? 20_000));\nconst MAX_HOLD_MS = Math.max(MIN_HOLD_MS, Number(process.env.PAPER_MAX_HOLD_MS ?? 3 * 60_000));\nconst NET_HARD_STOP_USD = Math.max(1, Number(process.env.PAPER_NET_HARD_STOP_USD ?? 4));\nconst EARLY_EXIT_MS = Math.max(MIN_HOLD_MS, Number(process.env.PAPER_EARLY_EXIT_MS ?? 45_000));`;
if (!s.includes('const MIN_NET_EDGE_USD =')) s = s.replace(anchor, `${anchor}\n${constants}`);

s = s.replace(/interface PositionMarket \{[^\n]*\}/, 'interface PositionMarket { protocol: string; pool: Addr; quote: Addr; entryCostUsd: number; }');
if (!s.includes('interface PositionMarket { protocol: string; pool: Addr; quote: Addr; entryCostUsd: number; }')) throw new Error('position market patch failed');

const oldQuoteGate = "const best = chooseBestQuote([this.makePaperQuote(swap.targetToken, market.priceUsd, market.liquidityUsd, this.entrySizeUsd)]);\n    if (best === undefined) { this.reject(swap, 'no_executable_quote'); return; }";
const newQuoteGate = `const best = chooseBestQuote([this.makePaperQuote(swap.targetToken, market.priceUsd, market.liquidityUsd, this.entrySizeUsd)]);\n    if (best === undefined) { this.reject(swap, 'no_executable_quote'); return; }\n    const entryCostUsd = best.quote.dexFeeUsd + best.quote.slippageUsd + best.quote.priceImpactUsd + (Number(best.quote.gasEstimate * best.quote.gasPriceWei) / 1e18) * best.quote.nativeTokenUsd;\n    const estimatedExitAmountUsd = Math.max(0, this.entrySizeUsd - entryCostUsd);\n    const estimatedExit = this.makePaperQuote(swap.targetToken, market.priceUsd, market.liquidityUsd, estimatedExitAmountUsd, estimatedExitAmountUsd);\n    const estimatedRoundTripCostUsd = entryCostUsd + estimatedExit.dexFeeUsd + estimatedExit.slippageUsd + estimatedExit.priceImpactUsd + (Number(estimatedExit.gasEstimate * estimatedExit.gasPriceWei) / 1e18) * estimatedExit.nativeTokenUsd;\n    const requiredMovePct = ((estimatedRoundTripCostUsd * ROUND_TRIP_COST_BUFFER + MIN_NET_EDGE_USD) / Math.max(this.entrySizeUsd, 1)) * 100;\n    if (flow.priceChangePct < requiredMovePct) { this.reject(swap, 'edge_below_round_trip_cost', { priceChangePct: flow.priceChangePct, requiredMovePct, estimatedRoundTripCostUsd, entryCostUsd, minNetEdgeUsd: MIN_NET_EDGE_USD }); return; }`;
if (!s.includes("'edge_below_round_trip_cost'")) {
  if (!s.includes(oldQuoteGate)) throw new Error('entry quote gate not found');
  s = s.replace(oldQuoteGate, newQuoteGate);
}

s = s.replace(
  "this.positionMarkets.set(position.id, { protocol: swap.protocol ?? V2_PROTOCOL, pool: swap.pool, quote: swap.quoteToken as Addr });",
  "this.positionMarkets.set(position.id, { protocol: swap.protocol ?? V2_PROTOCOL, pool: swap.pool, quote: swap.quoteToken as Addr, entryCostUsd });",
);

const oldMark = "const pnlUsd = update.position.entryPriceUsd > 0 ? update.position.sizeUsd * ((update.position.currentPriceUsd / update.position.entryPriceUsd) - 1) : 0;\n      const pnlPct = update.position.entryPriceUsd > 0 ? ((update.position.currentPriceUsd / update.position.entryPriceUsd) - 1) * 100 : 0;";
const newMark = `const pnlUsd = update.position.entryPriceUsd > 0 ? update.position.sizeUsd * ((update.position.currentPriceUsd / update.position.entryPriceUsd) - 1) : 0;\n      const pnlPct = update.position.entryPriceUsd > 0 ? ((update.position.currentPriceUsd / update.position.entryPriceUsd) - 1) * 100 : 0;\n      const ageMs = Math.max(0, Date.now() - update.position.openedAt);\n      const entryCostUsd = marketRef.entryCostUsd;\n      const exitProbe = this.makePaperQuote(position.token, market.priceUsd, market.liquidityUsd, update.position.sizeUsd, Math.max(0, update.position.sizeUsd + pnlUsd));\n      const estimatedExitCostUsd = exitProbe.dexFeeUsd + exitProbe.slippageUsd + exitProbe.priceImpactUsd + (Number(exitProbe.gasEstimate * exitProbe.gasPriceWei) / 1e18) * exitProbe.nativeTokenUsd;\n      const estimatedNetPnlUsd = pnlUsd - entryCostUsd - estimatedExitCostUsd;\n      const deterioration = update.decision.action === 'TIGHTEN' || update.decision.action === 'SELL';\n      const takeProfitReady = estimatedNetPnlUsd >= MIN_NET_EDGE_USD && ageMs >= MIN_HOLD_MS && deterioration;\n      const netHardStop = estimatedNetPnlUsd <= -NET_HARD_STOP_USD && ageMs >= MIN_HOLD_MS;\n      const maxHold = ageMs >= MAX_HOLD_MS;\n      const earlyFailure = ageMs >= EARLY_EXIT_MS && deterioration && estimatedNetPnlUsd <= 0;\n      const shouldExit = takeProfitReady || netHardStop || maxHold || earlyFailure || update.decision.action === 'SELL';`;
if (!s.includes('const takeProfitReady =')) {
  if (!s.includes(oldMark)) throw new Error('mark block not found');
  s = s.replace(oldMark, newMark);
}

s = s.replace(
  "if (update.decision.action !== 'SELL') continue;",
  "if (!shouldExit) continue;",
);

s = s.replace(
  "const netPnlUsd = exitValueUsd - position.sizeUsd;",
  "const netPnlUsd = exitValueUsd - position.sizeUsd - entryCostUsd;",
);

s = s.replace(
  "payload: { positionId: position.id, currentPriceUsd: update.position.currentPriceUsd, pnlUsd, pnlPct, state: update.position.state, momentum, momentumPeak: update.position.momentumPeak, volumeAcceleration: flow?.volumeAccelerationPct ?? 0, exitAction: update.decision.action, exitReason: update.decision.reason }",
  "payload: { positionId: position.id, currentPriceUsd: update.position.currentPriceUsd, pnlUsd, pnlPct, state: update.position.state, momentum, momentumPeak: update.position.momentumPeak, volumeAcceleration: flow?.volumeAccelerationPct ?? 0, exitAction: update.decision.action, exitReason: update.decision.reason, ageMs, entryCostUsd, estimatedExitCostUsd, estimatedNetPnlUsd, takeProfitReady, netHardStop, maxHold, earlyFailure }",
);

s = s.replace(
  "console.log(JSON.stringify({ event: 'paper_exit', positionId: position.id, priceUsd: market.priceUsd, pnlUsd: netPnlUsd, pnlPct: netPnlPct, grossPnlUsd: pnlUsd, exitCostUsd: sell.fill.cost.totalUsd, reason: update.decision.reason }));",
  "console.log(JSON.stringify({ event: 'paper_exit', positionId: position.id, priceUsd: market.priceUsd, pnlUsd: netPnlUsd, pnlPct: netPnlPct, grossPnlUsd: pnlUsd, entryCostUsd, exitCostUsd: sell.fill.cost.totalUsd, reason: takeProfitReady ? 'take_profit' : netHardStop ? 'net_hard_stop' : maxHold ? 'max_hold' : earlyFailure ? 'early_failure' : update.decision.reason }));",
);

fs.writeFileSync(path, s);
console.log(JSON.stringify({ event: 'strategy_patch', minNetEdgeUsd: MIN_NET_EDGE_USD, roundTripCostBuffer: ROUND_TRIP_COST_BUFFER, minHoldMs: MIN_HOLD_MS, maxHoldMs: MAX_HOLD_MS, netHardStopUsd: NET_HARD_STOP_USD, earlyExitMs: EARLY_EXIT_MS, source: path }));
